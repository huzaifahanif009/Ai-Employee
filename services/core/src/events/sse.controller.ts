import { Controller, Inject, Logger, MessageEvent, Param, Query, Req, Sse } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EventBus } from '@praxis/contracts';
import { PlatformEvent } from '@praxis/event-schemas';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { Public } from '../common/decorators';
import { EVENT_BUS } from './tokens';
import { RunEventsService } from './run-events.service';

/**
 * prd/11 §5 / ADR-0007. SSE for one-way streams.
 * EventSource can't set headers → token via ?token= query param.
 * Reconnect: client sends Last-Event-ID (or ?lastEventId=) → backfill from run_event by seq, then live.
 */
@Controller('streams')
export class SseController {
  private readonly log = new Logger('SSE');

  constructor(
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    private readonly jwt: JwtService,
    private readonly runEvents: RunEventsService,
  ) {}

  private auth(req: Request, token?: string): { userId: string; tenantId: string } {
    const raw = token ?? req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!raw) throw new Error('missing token');
    const claims = this.jwt.verify(raw) as { sub: string; tid: string };
    return { userId: claims.sub, tenantId: claims.tid };
  }

  @Public()
  @Sse('runs/:id')
  runStream(
    @Param('id') runId: string,
    @Query('token') token: string | undefined,
    @Query('lastEventId') lastEventIdQ: string | undefined,
    @Req() req: Request,
  ): Observable<MessageEvent> {
    const { tenantId } = this.auth(req, token);
    const lastEventId = Number(lastEventIdQ ?? req.headers['last-event-id'] ?? 0) || 0;
    const topic = `tenant.${tenantId}.run.${runId}`;

    return new Observable<MessageEvent>((subscriber) => {
      let closed = false;
      let sub: { unsubscribe: () => Promise<void> } | undefined;
      let maxSeqSent = lastEventId;

      const emit = (e: PlatformEvent) => {
        if (closed) return;
        if (typeof e.seq === 'number') {
          if (e.seq <= maxSeqSent) return; // dedupe against backfill
          maxSeqSent = e.seq;
        }
        subscriber.next({ id: String(e.seq ?? e.id), type: e.type, data: e });
      };

      (async () => {
        try {
          const backfill = await this.runEvents.since(runId, lastEventId);
          backfill.forEach(emit);
          sub = await this.bus.subscribe(topic, `sse-${runId}-${Date.now()}`, (e) => emit(e));
        } catch (err) {
          subscriber.error(err);
        }
      })();

      const heartbeat = setInterval(() => {
        if (!closed) subscriber.next({ type: 'heartbeat', data: { t: Date.now() } });
      }, 15000);

      return () => {
        closed = true;
        clearInterval(heartbeat);
        void sub?.unsubscribe();
      };
    });
  }

  @Public()
  @Sse('fleet')
  fleetStream(
    @Query('token') token: string | undefined,
    @Req() req: Request,
  ): Observable<MessageEvent> {
    const { tenantId } = this.auth(req, token);
    const topic = `tenant.${tenantId}.fleet`;
    return new Observable<MessageEvent>((subscriber) => {
      let closed = false;
      let sub: { unsubscribe: () => Promise<void> } | undefined;
      (async () => {
        sub = await this.bus.subscribe(topic, `sse-fleet-${Date.now()}`, (e) => {
          if (!closed) subscriber.next({ id: e.id, type: e.type, data: e });
        });
      })();
      const heartbeat = setInterval(() => {
        if (!closed) subscriber.next({ type: 'heartbeat', data: { t: Date.now() } });
      }, 15000);
      return () => {
        closed = true;
        clearInterval(heartbeat);
        void sub?.unsubscribe();
      };
    });
  }
}
