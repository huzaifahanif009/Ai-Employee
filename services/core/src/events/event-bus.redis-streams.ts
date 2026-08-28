import { Logger } from '@nestjs/common';
import { EventBus, Subscription } from '@praxis/contracts';
import { PlatformEvent } from '@praxis/event-schemas';
import Redis from 'ioredis';

/**
 * Redis Streams bus (EVENT_BUS_DRIVER=redis-streams). One stream per concrete topic;
 * a subscription with a wildcard fans over matching streams via keyspace scan + XREAD.
 * The bus is a projection — Postgres run_event is the source of truth (ADR-0006).
 */
export class RedisStreamsEventBus implements EventBus {
  readonly driver = 'redis-streams' as const;
  private readonly log = new Logger('RedisStreamsEventBus');
  private readonly pub: Redis;
  private stopped = false;

  constructor(
    private readonly url: string,
    private readonly maxlen: number,
  ) {
    this.pub = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  }

  private streamKey(topic: string): string {
    return `praxis:evt:${topic}`;
  }

  async publish(topic: string, event: PlatformEvent): Promise<void> {
    await this.pub.xadd(
      this.streamKey(topic),
      'MAXLEN',
      '~',
      String(this.maxlen),
      '*',
      'data',
      JSON.stringify(event),
    );
  }

  async subscribe(
    topicPattern: string,
    _group: string,
    handler: (e: PlatformEvent, ack: () => void) => void,
  ): Promise<Subscription> {
    const conn = new Redis(this.url, { maxRetriesPerRequest: null });
    const matchGlob = `praxis:evt:${topicPattern.replace(/\*/g, '*').replace(/>/g, '*')}`;
    // cursor per stream
    const cursors = new Map<string, string>();
    let running = true;

    const loop = async () => {
      while (running && !this.stopped) {
        try {
          const keys = await scanKeys(conn, matchGlob);
          if (keys.length === 0) {
            await sleep(250);
            continue;
          }
          const streams = keys.flatMap((k) => [k]);
          const ids = keys.map((k) => cursors.get(k) ?? '$');
          const res = (await (conn as unknown as {
            xread: (...a: unknown[]) => Promise<unknown>;
          }).xread('BLOCK', 1000, 'COUNT', 100, 'STREAMS', ...streams, ...ids)) as
            | [string, [string, string[]][]][]
            | null;
          if (!res) continue;
          for (const [key, entries] of res) {
            for (const [id, fields] of entries) {
              cursors.set(key, id);
              const dataIdx = fields.indexOf('data');
              if (dataIdx >= 0) {
                try {
                  const event = JSON.parse(fields[dataIdx + 1]) as PlatformEvent;
                  handler(event, () => undefined);
                } catch (err) {
                  this.log.warn(`bad event on ${key}: ${(err as Error).message}`);
                }
              }
            }
          }
        } catch (err) {
          if (running) this.log.warn(`subscribe loop: ${(err as Error).message}`);
          await sleep(500);
        }
      }
      await conn.quit();
    };
    void loop();

    return {
      unsubscribe: async () => {
        running = false;
      },
    };
  }

  async close(): Promise<void> {
    this.stopped = true;
    await this.pub.quit();
  }
}

async function scanKeys(conn: Redis, match: string): Promise<string[]> {
  const out: string[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await conn.scan(cursor, 'MATCH', match, 'COUNT', 200);
    cursor = next;
    out.push(...keys);
  } while (cursor !== '0');
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
