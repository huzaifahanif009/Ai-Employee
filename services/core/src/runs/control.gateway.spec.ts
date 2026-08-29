import type { JwtService } from '@nestjs/jwt';
import { ControlGateway } from './control.gateway';
import type { RunsService } from './runs.service';

class FakeSocket {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  closed?: { code: number; reason: string };
  send(s: string) {
    this.sent.push(s);
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
    this.readyState = 3;
  }
  lastFrame() {
    return this.sent.length ? JSON.parse(this.sent[this.sent.length - 1]) : undefined;
  }
}

function makeGateway(opts: {
  verify?: (t: string) => unknown;
  control?: jest.Mock;
  get?: jest.Mock;
  subscribe?: jest.Mock;
}) {
  const jwt = {
    verify: opts.verify ?? (() => ({ sub: 'u1', tid: 't1', role: 'operator' })),
  } as unknown as JwtService;
  const runs = {
    control: opts.control ?? jest.fn().mockResolvedValue({ ok: true }),
    get: opts.get ?? jest.fn().mockResolvedValue({ id: 'r1' }),
  } as unknown as RunsService;
  const bus = {
    subscribe:
      opts.subscribe ??
      jest.fn().mockResolvedValue({ unsubscribe: jest.fn().mockResolvedValue(undefined) }),
  };
  return new ControlGateway(jwt, runs, bus as never);
}

describe('ControlGateway', () => {
  it('rejects a connection with a bad token (close 4401)', () => {
    const gw = makeGateway({
      verify: () => {
        throw new Error('bad');
      },
    });
    const sock = new FakeSocket();
    gw.handleConnection(sock as never, { url: '/api/v1/control?token=nope' } as never);
    expect(sock.closed?.code).toBe(4401);
  });

  it('authenticates from the handshake query and greets with hello', () => {
    const gw = makeGateway({});
    const sock = new FakeSocket();
    gw.handleConnection(sock as never, { url: '/api/v1/control?token=good' } as never);
    expect(sock.lastFrame()).toMatchObject({ event: 'hello', data: { userId: 'u1', tenantId: 't1' } });
  });

  it('refuses subscribe / control before auth', async () => {
    const gw = makeGateway({});
    const sock = new FakeSocket();
    // no token on connect
    gw.handleConnection(sock as never, { url: '/api/v1/control' } as never);
    expect(await gw.onSubscribe(sock as never, { runId: 'r1' })).toMatchObject({ event: 'error' });
    expect(await gw.onControl(sock as never, { runId: 'r1', op: 'pause' })).toMatchObject({
      event: 'error',
    });
  });

  it('subscribes to a run and forwards bus events as run.event frames', async () => {
    let handler: ((e: unknown) => void) | undefined;
    const subscribe = jest.fn().mockImplementation((_topic, _grp, h) => {
      handler = h;
      return Promise.resolve({ unsubscribe: jest.fn().mockResolvedValue(undefined) });
    });
    const gw = makeGateway({ subscribe });
    const sock = new FakeSocket();
    gw.handleConnection(sock as never, { url: '/api/v1/control?token=good' } as never);

    const res = await gw.onSubscribe(sock as never, { runId: 'r1' });
    expect(res).toMatchObject({ event: 'subscribed', data: { runId: 'r1' } });
    expect(subscribe).toHaveBeenCalledWith('tenant.t1.run.r1', expect.any(String), expect.any(Function));

    handler?.({ type: 'run.state_changed', seq: 5 });
    expect(sock.lastFrame()).toMatchObject({ event: 'run.event', data: { type: 'run.state_changed' } });
  });

  it('runs a control op through RunsService.control and acks', async () => {
    const control = jest.fn().mockResolvedValue({ ok: true });
    const gw = makeGateway({ control });
    const sock = new FakeSocket();
    gw.handleConnection(sock as never, { url: '/api/v1/control?token=good' } as never);

    const res = await gw.onControl(sock as never, { runId: 'r1', op: 'cancel', body: { reason: 'x' } });
    expect(control).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', tenantId: 't1' }),
      'r1',
      'cancel',
      { reason: 'x' },
    );
    expect(res).toMatchObject({ event: 'control:ack', data: { runId: 'r1', op: 'cancel', ok: true } });
  });

  it('rejects an unknown control op', async () => {
    const gw = makeGateway({});
    const sock = new FakeSocket();
    gw.handleConnection(sock as never, { url: '/api/v1/control?token=good' } as never);
    expect(await gw.onControl(sock as never, { runId: 'r1', op: 'explode' as never })).toMatchObject({
      event: 'control:error',
    });
  });

  it('denies control to a role without run:control', async () => {
    const gw = makeGateway({ verify: () => ({ sub: 'u1', tid: 't1', role: 'viewer' }) });
    const sock = new FakeSocket();
    gw.handleConnection(sock as never, { url: '/api/v1/control?token=good' } as never);
    const res = await gw.onControl(sock as never, { runId: 'r1', op: 'pause' });
    expect(res).toMatchObject({ event: 'control:error', data: { message: expect.stringContaining('run:control') } });
  });

  it('surfaces a RunsService.control failure as control:error', async () => {
    const control = jest.fn().mockRejectedValue(new Error('Run already succeeded'));
    const gw = makeGateway({ control });
    const sock = new FakeSocket();
    gw.handleConnection(sock as never, { url: '/api/v1/control?token=good' } as never);
    expect(await gw.onControl(sock as never, { runId: 'r1', op: 'pause' })).toMatchObject({
      event: 'control:error',
      data: { message: 'Run already succeeded' },
    });
  });

  it('ping -> pong', () => {
    const gw = makeGateway({});
    expect(gw.onPing()).toMatchObject({ event: 'pong' });
  });
});
