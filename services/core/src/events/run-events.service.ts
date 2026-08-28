import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventBus } from '@praxis/contracts';
import { CURRENT_SCHEMA_VERSION, PlatformEvent } from '@praxis/event-schemas';
import { DataSource, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { RunEventEntity } from '../database/entities';
import { EVENT_BUS } from './tokens';

export interface AppendInput {
  tenantId: string;
  runId: string;
  type: string;
  payload: Record<string, unknown>;
  actor?: { kind: 'user' | 'service' | 'agent' | 'system'; id: string; display?: string };
  traceId?: string;
}

/**
 * Append a typed event to run_event (source of truth) with a gap-free per-run `seq`,
 * then publish to the bus (ADR-0006). `seq` is assigned under a transaction-level
 * advisory lock keyed by runId to serialise concurrent appends.
 */
@Injectable()
export class RunEventsService {
  private readonly log = new Logger('RunEvents');

  constructor(
    @InjectRepository(RunEventEntity) private readonly repo: Repository<RunEventEntity>,
    private readonly ds: DataSource,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {}

  async append(input: AppendInput): Promise<PlatformEvent> {
    const row = await this.ds.transaction(async (m) => {
      // advisory lock: hashtext(runId) → serialize seq allocation for this run
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [input.runId]);
      const { max } = (await m
        .createQueryBuilder(RunEventEntity, 'e')
        .select('COALESCE(MAX(e.seq), 0)', 'max')
        .where('e.runId = :runId', { runId: input.runId })
        .getRawOne()) as { max: string };
      const seq = Number(max) + 1;
      const entity = m.create(RunEventEntity, {
        tenantId: input.tenantId,
        runId: input.runId,
        seq,
        type: input.type,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        traceId: input.traceId ?? null,
        payload: input.payload,
        actor: input.actor ?? null,
        ts: new Date(),
        published: false,
      });
      return m.save(entity);
    });

    const event: PlatformEvent = {
      id: uuidv7(),
      type: row.type,
      schemaVersion: row.schemaVersion,
      tenantId: row.tenantId,
      runId: row.runId,
      seq: row.seq,
      traceId: row.traceId ?? undefined,
      ts: row.ts.toISOString(),
      actor: row.actor as PlatformEvent['actor'],
      payload: row.payload,
    };

    try {
      await this.bus.publish(`tenant.${row.tenantId}.run.${row.runId}`, event);
      await this.bus.publish(`tenant.${row.tenantId}.fleet`, event);
      await this.repo.update({ id: row.id }, { published: true });
    } catch (err) {
      // not fatal: an outbox sweeper (Phase 2) will republish unpublished rows
      this.log.warn(`publish failed for run_event ${row.id}: ${(err as Error).message}`);
    }
    return event;
  }

  /** SSE backfill: events for a run after a given seq. */
  async since(runId: string, afterSeq: number, limit = 500): Promise<PlatformEvent[]> {
    const rows = await this.repo.find({
      where: { runId },
      order: { seq: 'ASC' },
      take: limit,
    });
    return rows
      .filter((r) => r.seq > afterSeq)
      .map((r) => ({
        id: String(r.id),
        type: r.type,
        schemaVersion: r.schemaVersion,
        tenantId: r.tenantId,
        runId: r.runId,
        seq: r.seq,
        traceId: r.traceId ?? undefined,
        ts: r.ts.toISOString(),
        actor: r.actor as PlatformEvent['actor'],
        payload: r.payload,
      }));
  }
}
