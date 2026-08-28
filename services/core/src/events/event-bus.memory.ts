import { EventBus, Subscription } from '@praxis/contracts';
import { PlatformEvent } from '@praxis/event-schemas';

type Handler = (e: PlatformEvent, ack: () => void) => void | Promise<void>;

/** In-process bus for tests and single-node dev (EVENT_BUS_DRIVER=memory). */
export class MemoryEventBus implements EventBus {
  readonly driver = 'memory' as const;
  private subs: { pattern: RegExp; handler: Handler }[] = [];

  async publish(topic: string, event: PlatformEvent): Promise<void> {
    for (const s of this.subs) {
      if (s.pattern.test(topic)) {
        // fire-and-forget; ack is a no-op here
        void s.handler(event, () => undefined);
      }
    }
  }

  async subscribe(topicPattern: string, _group: string, handler: Handler): Promise<Subscription> {
    const pattern = new RegExp(
      '^' + topicPattern.replace(/[.]/g, '\\.').replace(/\*/g, '[^.]+').replace(/>/g, '.*') + '$',
    );
    const entry = { pattern, handler };
    this.subs.push(entry);
    return {
      unsubscribe: async () => {
        this.subs = this.subs.filter((s) => s !== entry);
      },
    };
  }

  async close(): Promise<void> {
    this.subs = [];
  }
}
