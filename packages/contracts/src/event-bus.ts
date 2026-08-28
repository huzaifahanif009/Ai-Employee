import { PlatformEvent } from '@praxis/event-schemas';

export interface Subscription {
  unsubscribe(): Promise<void>;
}

export type EventHandler = (event: PlatformEvent, ack: () => void) => void | Promise<void>;

/**
 * ADR-0006 / ADR-0010. The bus is a *projection* for live fan-out — Postgres `run_event`
 * is the source of truth. Drivers: `memory` (tests), `redis-streams` (dev/small), `nats` (scale).
 *
 * Topic conventions:
 *   tenant.<tid>.run.<rid>
 *   tenant.<tid>.fleet
 *   tenant.<tid>.approvals
 *   tenant.<tid>.connectors
 */
export interface EventBus {
  readonly driver: 'memory' | 'redis-streams' | 'nats';

  publish(topic: string, event: PlatformEvent): Promise<void>;

  subscribe(topicPattern: string, group: string, handler: EventHandler): Promise<Subscription>;

  close(): Promise<void>;
}
