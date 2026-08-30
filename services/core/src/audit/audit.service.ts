import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLogEntity } from '../database/entities';

/** deterministic JSON with recursively sorted object keys */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

export interface AuditInput {
  tenantId: string;
  actor: { kind: string; id: string; display?: string };
  action: string;
  target: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/** Append-only, per-tenant hash-chained audit trail (prd/14 §8). */
@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');

  constructor(
    @InjectRepository(AuditLogEntity) private readonly repo: Repository<AuditLogEntity>,
    private readonly ds: DataSource,
  ) {}

  private chainHash(
    prevHash: string | null,
    e: {
      tenantId: string;
      actor: unknown;
      action: string;
      target: unknown;
      before: unknown;
      after: unknown;
      tsIso: string;
    },
  ): string {
    // canonical (key-sorted) JSON — Postgres jsonb does not preserve key order
    const payload = stableStringify({
      tenantId: e.tenantId,
      actor: e.actor,
      action: e.action,
      target: e.target,
      before: e.before,
      after: e.after,
      ts: e.tsIso,
    });
    return createHash('sha256').update(`${prevHash ?? ''}\n${payload}`).digest('hex');
  }

  async record(input: AuditInput): Promise<void> {
    try {
      await this.ds.transaction(async (m) => {
        // serialise the chain per tenant
        await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`audit:${input.tenantId}`]);
        const prev = await m
          .createQueryBuilder(AuditLogEntity, 'a')
          .select('a.hash', 'hash')
          .where('a.tenantId = :t', { t: input.tenantId })
          .orderBy('a.id', 'DESC')
          .limit(1)
          .getRawOne<{ hash: string }>();
        const prevHash = prev?.hash ?? null;
        const ts = new Date();
        const hash = this.chainHash(prevHash, {
          tenantId: input.tenantId,
          actor: input.actor,
          action: input.action,
          target: input.target,
          before: input.before ?? null,
          after: input.after ?? null,
          tsIso: ts.toISOString(),
        });
        await m.save(
          m.create(AuditLogEntity, {
            tenantId: input.tenantId,
            actor: input.actor,
            action: input.action,
            target: input.target,
            before: input.before ?? null,
            after: input.after ?? null,
            ts,
            prevHash,
            hash,
          }),
        );
      });
    } catch (err) {
      // auditing must never break the request it describes
      this.log.warn(`audit record failed: ${(err as Error).message}`);
    }
  }

  async list(
    tenantId: string,
    opts: { limit?: number; cursor?: string; action?: string; actorId?: string } = {},
  ) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const qb = this.repo
      .createQueryBuilder('a')
      .where('a.tenantId = :t', { t: tenantId })
      .orderBy('a.id', 'DESC')
      .take(limit + 1);
    if (opts.cursor) qb.andWhere('a.id < :c', { c: opts.cursor });
    if (opts.action) qb.andWhere('a.action ILIKE :act', { act: `%${opts.action}%` });
    if (opts.actorId) qb.andWhere(`a.actor->>'id' = :aid`, { aid: opts.actorId });
    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const data = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
      id: r.id,
      ts: r.ts,
      actor: r.actor,
      action: r.action,
      target: r.target,
      after: r.after,
      hash: r.hash.slice(0, 12),
    }));
    return { data, nextCursor: hasMore ? String(data[data.length - 1].id) : null };
  }

  /** walk the chain oldest→newest and confirm every hash links */
  async verifyChain(tenantId: string) {
    const rows = await this.repo.find({ where: { tenantId }, order: { id: 'ASC' } });
    let prevHash: string | null = null;
    for (const r of rows) {
      const computed = this.chainHash(prevHash, {
        tenantId: r.tenantId,
        actor: r.actor,
        action: r.action,
        target: r.target,
        before: r.before ?? null,
        after: r.after ?? null,
        tsIso: r.ts.toISOString(),
      });
      if (r.prevHash !== prevHash || r.hash !== computed) {
        return { ok: false, entries: rows.length, brokenAt: r.id };
      }
      prevHash = r.hash;
    }
    return { ok: true, entries: rows.length, brokenAt: null };
  }
}
