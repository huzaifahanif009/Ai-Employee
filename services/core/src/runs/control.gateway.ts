import { Inject, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { EventBus, Subscription } from '@praxis/contracts';
import type { PlatformEvent } from '@praxis/event-schemas';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { Role, roleHas } from '../common/rbac';
import type { RequestContext } from '../common/request-context';
import { EVENT_BUS } from '../events/tokens';
import { RunsService } from './runs.service';

interface ClientState {
  ctx: RequestContext;
  subs: Map<string, Subscription>; // runId -> bus subscription
}

type ControlOp = 'pause' | 'resume' | 'cancel' | 'comment';
const CONTROL_OPS: ControlOp[] = ['pause', 'resume', 'cancel', 'comment'];

/**
 * Bidirectional run-control channel (prd/11 §5, prd/12 §6). SSE stays the
 * fallback for one-way streaming; this socket adds low-latency operator
 * actions (pause / resume / cancel / comment) and pushes the same run events
 * back so an open Run detail view needs no polling.
 *
 * Auth: browsers can't set headers on `new WebSocket()`, so the access token
 * comes as `?token=` on the handshake URL (same approach as the SSE routes),
 * with an `{event:"auth"}` first-message fallback.
 *
 * Framing (via @nestjs/platform-ws WsAdapter): every message is
 * `{"event": "<name>", "data": <payload>}`.
 */
@WebSocketGateway({ path: '/api/v1/control' })
export class ControlGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger('ControlGateway');
  private readonly clients = new WeakMap<WebSocket, ClientState>();

  constructor(
    private readonly jwt: JwtService,
    private readonly runs: RunsService,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {}

  handleConnection(client: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const token = url.searchParams.get('token') ?? undefined;
    if (token) {
      const ctx = this.verify(token);
      if (!ctx) return this.closeUnauthorized(client);
      this.attach(client, ctx);
    }
    // else: wait for an {event:"auth"} message before honouring anything else
  }

  handleDisconnect(client: WebSocket) {
    const state = this.clients.get(client);
    if (!state) return;
    for (const sub of state.subs.values()) void sub.unsubscribe().catch(() => undefined);
    state.subs.clear();
    this.clients.delete(client);
  }

  @SubscribeMessage('auth')
  onAuth(client: WebSocket, data: { token?: string }) {
    if (this.clients.get(client)) return { event: 'hello', data: this.helloData(client) };
    const ctx = data?.token ? this.verify(data.token) : null;
    if (!ctx) {
      this.closeUnauthorized(client);
      return { event: 'error', data: { message: 'unauthorized' } };
    }
    this.attach(client, ctx);
    return { event: 'hello', data: this.helloData(client) };
  }

  @SubscribeMessage('subscribe')
  async onSubscribe(client: WebSocket, data: { runId?: string }) {
    const state = this.requireAuthed(client);
    if (!state) return { event: 'error', data: { message: 'unauthorized' } };
    const runId = data?.runId;
    if (!runId) return { event: 'error', data: { message: 'runId required' } };
    if (state.subs.has(runId)) return { event: 'subscribed', data: { runId } };

    try {
      await this.runs.get(state.ctx.tenantId, runId); // 404s if not this tenant's run
    } catch {
      return { event: 'error', data: { runId, message: 'run not found' } };
    }

    const topic = `tenant.${state.ctx.tenantId}.run.${runId}`;
    const sub = await this.bus.subscribe(topic, `ws-${runId}-${Date.now()}`, (e: PlatformEvent) => {
      this.safeSend(client, { event: 'run.event', data: e });
    });
    state.subs.set(runId, sub);
    return { event: 'subscribed', data: { runId } };
  }

  @SubscribeMessage('unsubscribe')
  async onUnsubscribe(client: WebSocket, data: { runId?: string }) {
    const state = this.clients.get(client);
    const runId = data?.runId;
    if (state && runId && state.subs.has(runId)) {
      await state.subs.get(runId)!.unsubscribe().catch(() => undefined);
      state.subs.delete(runId);
    }
    return { event: 'unsubscribed', data: { runId } };
  }

  @SubscribeMessage('control')
  async onControl(
    client: WebSocket,
    data: { runId?: string; op?: ControlOp; body?: { reason?: string; text?: string } },
  ) {
    const state = this.requireAuthed(client);
    if (!state) return { event: 'error', data: { message: 'unauthorized' } };

    const { runId, op } = data ?? {};
    if (!runId || !op || !CONTROL_OPS.includes(op)) {
      return { event: 'control:error', data: { runId, op, message: 'runId and a valid op are required' } };
    }
    if (!roleHas(state.ctx.role, 'run:control')) {
      return { event: 'control:error', data: { runId, op, message: 'requires capability run:control' } };
    }

    try {
      await this.runs.control(state.ctx, runId, op, data.body ?? {});
      return { event: 'control:ack', data: { runId, op, ok: true } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { event: 'control:error', data: { runId, op, message } };
    }
  }

  @SubscribeMessage('ping')
  onPing() {
    return { event: 'pong', data: { t: Date.now() } };
  }

  // --- helpers ---

  private verify(token: string): RequestContext | null {
    try {
      const c = this.jwt.verify(token) as { sub: string; tid: string; role: Role };
      return { userId: c.sub, tenantId: c.tid, role: c.role, requestId: `ws-${Date.now()}` };
    } catch {
      return null;
    }
  }

  private attach(client: WebSocket, ctx: RequestContext) {
    this.clients.set(client, { ctx, subs: new Map() });
    this.safeSend(client, { event: 'hello', data: this.helloData(client) });
    this.log.log(`ws client ${ctx.userId}@${ctx.tenantId} connected`);
  }

  private requireAuthed(client: WebSocket): ClientState | null {
    return this.clients.get(client) ?? null;
  }

  private helloData(client: WebSocket) {
    const s = this.clients.get(client);
    return { userId: s?.ctx.userId, tenantId: s?.ctx.tenantId, role: s?.ctx.role };
  }

  private closeUnauthorized(client: WebSocket) {
    this.safeSend(client, { event: 'error', data: { message: 'unauthorized' } });
    try {
      client.close(4401, 'unauthorized');
    } catch {
      /* already closing */
    }
  }

  private safeSend(client: WebSocket, frame: { event: string; data: unknown }) {
    if (client.readyState !== client.OPEN) return;
    try {
      client.send(JSON.stringify(frame));
    } catch (err) {
      this.log.warn(`ws send failed: ${(err as Error).message}`);
    }
  }
}
