import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ApprovalEntity,
  ModelCallEntity,
  RunEntity,
  RunEventEntity,
  ToolCallEntity,
  WorkItemEntity,
} from '../database/entities';

const TERMINAL = ['succeeded', 'failed', 'cancelled', 'timed_out'];
const ACTIVITY_TYPES = [
  'run.created',
  'run.state_changed',
  'run.completed',
  'run.failed',
  'plan.created',
  'approval.requested',
  'approval.decided',
  'run_step.started',
  'run_step.finished',
  'verify.finished',
  'review.finished',
  'vcs.pr.opened',
  'git.pushed',
  'progress.warning',
];

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(RunEntity) private readonly runs: Repository<RunEntity>,
    @InjectRepository(RunEventEntity) private readonly events: Repository<RunEventEntity>,
    @InjectRepository(ModelCallEntity) private readonly modelCalls: Repository<ModelCallEntity>,
    @InjectRepository(ToolCallEntity) private readonly toolCalls: Repository<ToolCallEntity>,
    @InjectRepository(ApprovalEntity) private readonly approvals: Repository<ApprovalEntity>,
    @InjectRepository(WorkItemEntity) private readonly workItems: Repository<WorkItemEntity>,
  ) {}

  private since(hours: number) {
    return new Date(Date.now() - hours * 3600_000);
  }

  async overview(tenantId: string) {
    const day = this.since(24);
    const week = this.since(24 * 7);

    const allRuns = await this.runs.find({ where: { tenantId }, select: ['id', 'state', 'totals', 'createdAt', 'startedAt', 'endedAt', 'plan'] as never });
    const active = allRuns.filter((r) => !TERMINAL.includes(r.state));
    const completed7d = allRuns.filter((r) => r.endedAt && r.endedAt >= week);
    const succeeded7d = completed7d.filter((r) => r.state === 'succeeded');
    const runs24h = allRuns.filter((r) => r.createdAt >= day);

    const spendAll = allRuns.reduce((s, r) => s + (r.totals?.costUsd ?? 0), 0);
    const tokensAll = allRuns.reduce((s, r) => s + (r.totals?.tokens ?? 0), 0);
    const spend24h = runs24h.reduce((s, r) => s + (r.totals?.costUsd ?? 0), 0);
    const tokens24h = runs24h.reduce((s, r) => s + (r.totals?.tokens ?? 0), 0);
    const files24h = runs24h.reduce((s, r) => s + (r.totals?.filesChanged ?? 0), 0);

    const durs = succeeded7d
      .filter((r) => r.startedAt && r.endedAt)
      .map((r) => (r.endedAt!.getTime() - r.startedAt!.getTime()) / 1000);
    const avgRunSeconds = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;

    const [mc24h, tc24h, openApprovals, decided24h, awaitingPlan] = await Promise.all([
      this.modelCalls.createQueryBuilder('m').where('m.tenantId = :t', { t: tenantId }).andWhere('m.createdAt >= :d', { d: day }).getCount(),
      this.toolCalls.createQueryBuilder('t').where('t.tenantId = :t', { t: tenantId }).andWhere('t.createdAt >= :d', { d: day }).getCount(),
      this.approvals.count({ where: { tenantId, state: 'open' } }),
      this.approvals.createQueryBuilder('a').where('a.tenantId = :t', { t: tenantId }).andWhere('a.decidedAt >= :d', { d: day }).getCount(),
      this.approvals.count({ where: { tenantId, state: 'open', type: 'plan' } }),
    ]);

    const topModels = await this.modelCalls
      .createQueryBuilder('m')
      .select('m.model', 'model')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('COALESCE(SUM(m.costUsd),0)', 'costUsd')
      .addSelect('COALESCE(SUM(m.inputTokens + m.outputTokens),0)', 'tokens')
      .where('m.tenantId = :t', { t: tenantId })
      .groupBy('m.model')
      .orderBy('calls', 'DESC')
      .limit(6)
      .getRawMany();

    const topTools = await this.toolCalls
      .createQueryBuilder('t')
      .select('t.toolName', 'tool')
      .addSelect('COUNT(*)', 'calls')
      .addSelect("SUM(CASE WHEN t.status = 'ok' THEN 1 ELSE 0 END)", 'ok')
      .where('t.tenantId = :t', { t: tenantId })
      .groupBy('t.toolName')
      .orderBy('calls', 'DESC')
      .limit(8)
      .getRawMany();

    const byState = TERMINAL.concat(['planning', 'executing', 'verifying', 'reviewing', 'delivering', 'awaiting_plan_approval', 'awaiting_delivery_approval', 'queued'])
      .map((state) => ({ state, count: allRuns.filter((r) => r.state === state).length }))
      .filter((x) => x.count > 0);

    // autonomy: completed runs that never hit a rejected approval
    const rejectedRunIds = new Set(
      (await this.approvals.find({ where: { tenantId, state: 'rejected' }, select: ['runId'] })).map((a) => a.runId),
    );
    const cleanSucceeded = succeeded7d.filter((r) => !rejectedRunIds.has(r.id)).length;
    const autoPct = completed7d.length ? Math.round((cleanSucceeded / completed7d.length) * 100) : 0;

    return {
      runs: {
        total: allRuns.length,
        active: active.length,
        last24h: runs24h.length,
        succeeded7d: succeeded7d.length,
        failed7d: completed7d.filter((r) => r.state === 'failed' || r.state === 'timed_out').length,
      },
      successRate: completed7d.length ? Math.round((succeeded7d.length / completed7d.length) * 100) : null,
      autonomyPct: autoPct,
      approvals: { open: openApprovals, awaitingPlan, decided24h },
      spend: { last24hUsd: +spend24h.toFixed(4), allTimeUsd: +spendAll.toFixed(4), tokens24h, tokensAll },
      activity: { modelCalls24h: mc24h, toolCalls24h: tc24h, filesChanged24h: files24h },
      avgRunSeconds,
      byState,
      topModels: topModels.map((m) => ({ model: m.model, calls: +m.calls, costUsd: +Number(m.costUsd).toFixed(4), tokens: +m.tokens })),
      topTools: topTools.map((t) => ({ tool: t.tool, calls: +t.calls, ok: +t.ok })),
    };
  }

  /** hourly buckets for the last `hours` hours */
  async timeseries(tenantId: string, hours = 24) {
    const from = this.since(hours);
    const runRows = await this.runs
      .createQueryBuilder('r')
      .select("date_trunc('hour', r.createdAt)", 'bucket')
      .addSelect('COUNT(*)', 'started')
      .addSelect("SUM(CASE WHEN r.state = 'succeeded' THEN 1 ELSE 0 END)", 'succeeded')
      .addSelect("SUM(CASE WHEN r.state IN ('failed','timed_out') THEN 1 ELSE 0 END)", 'failed')
      .addSelect("COALESCE(SUM((r.totals->>'costUsd')::float),0)", 'spend')
      .addSelect("COALESCE(SUM((r.totals->>'tokens')::int),0)", 'tokens')
      .where('r.tenantId = :t', { t: tenantId })
      .andWhere('r.createdAt >= :from', { from })
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany();

    const map = new Map(runRows.map((b) => [new Date(b.bucket).toISOString(), b]));
    const out: { t: string; started: number; succeeded: number; failed: number; spendUsd: number; tokens: number }[] = [];
    const start = new Date(from);
    start.setMinutes(0, 0, 0);
    for (let d = new Date(start); d <= new Date(); d.setHours(d.getHours() + 1)) {
      const key = d.toISOString();
      const b = map.get(key);
      out.push({
        t: key,
        started: b ? +b.started : 0,
        succeeded: b ? +b.succeeded : 0,
        failed: b ? +b.failed : 0,
        spendUsd: b ? +Number(b.spend).toFixed(5) : 0,
        tokens: b ? +b.tokens : 0,
      });
    }
    return { hours, buckets: out };
  }

  async activity(tenantId: string, limit = 40) {
    const rows = await this.events
      .createQueryBuilder('e')
      .where('e.tenantId = :t', { t: tenantId })
      .andWhere('e.type IN (:...types)', { types: ACTIVITY_TYPES })
      .orderBy('e.ts', 'DESC')
      .limit(limit)
      .getMany();

    const runIds = [...new Set(rows.map((r) => r.runId))];
    const runs = runIds.length
      ? await this.runs.find({ where: runIds.map((id) => ({ id })), select: ['id', 'workItemId', 'state'] })
      : [];
    const wiIds = [...new Set(runs.map((r) => r.workItemId))];
    const wis = wiIds.length
      ? await this.workItems.find({ where: wiIds.map((id) => ({ id })), select: ['id', 'title'] })
      : [];
    const wiTitle = new Map(wis.map((w) => [w.id, w.title]));
    const runWi = new Map(runs.map((r) => [r.id, wiTitle.get(r.workItemId) ?? '—']));

    return rows.map((e) => ({
      seq: e.seq,
      ts: e.ts,
      type: e.type,
      runId: e.runId,
      workItem: runWi.get(e.runId) ?? '—',
      summary: this.summarize(e.type, e.payload as Record<string, unknown>),
    }));
  }

  async workload(tenantId: string) {
    const runs = await this.runs.find({ where: { tenantId }, select: ['id', 'state', 'endedAt', 'plan'] as never });
    const completed = runs.filter((r) => TERMINAL.includes(r.state));
    const approvals = await this.approvals.find({ where: { tenantId }, select: ['runId', 'state', 'type', 'decidedBy'] });
    const touchedRunIds = new Set(approvals.map((a) => a.runId));
    const rejectedRunIds = new Set(approvals.filter((a) => a.state === 'rejected').map((a) => a.runId));

    // tiers: L1 = succeeded, no human decision recorded; L2 = succeeded after a human approved;
    // L3 = a human rejected / the run failed
    let l1 = 0;
    let l2 = 0;
    let l3 = 0;
    for (const r of completed) {
      if (r.state === 'succeeded' && !touchedRunIds.has(r.id)) l1++;
      else if (r.state === 'succeeded') l2++;
      else l3++;
    }
    void rejectedRunIds;

    return {
      completed: completed.length,
      tiers: [
        { key: 'l1', label: 'Autonomous', count: l1 },
        { key: 'l2', label: 'Human-approved', count: l2 },
        { key: 'l3', label: 'Human-corrected / failed', count: l3 },
      ],
      byOutcome: ['succeeded', 'failed', 'cancelled', 'timed_out']
        .map((state) => ({ state, count: completed.filter((r) => r.state === state).length }))
        .filter((x) => x.count > 0),
    };
  }

  private summarize(type: string, p: Record<string, unknown>): string {
    switch (type) {
      case 'run.created':
        return String(p.title ?? 'run created');
      case 'run.state_changed':
        return `→ ${String(p.to ?? '')}`;
      case 'run.completed':
        return `succeeded${p.prUrl ? ' · PR opened' : ''}`;
      case 'run.failed':
        return `failed · ${String(p.category ?? '')}`;
      case 'plan.created':
        return `plan · ${String(p.stepCount ?? '?')} steps · ${String(p.risk ?? '')}`;
      case 'approval.requested':
        return `approval requested (${String(p.type ?? '')})`;
      case 'approval.decided':
        return `approval ${String(p.decision ?? '')}`;
      case 'run_step.started':
        return `▸ step #${String(p.index ?? '')} ${String(p.title ?? '')}`;
      case 'run_step.finished':
        return `✓ step ${String(p.state ?? '')} · ${String(p.filesWritten ?? 0)} files`;
      case 'verify.finished':
        return `verify ${String(p.overall ?? '')}`;
      case 'review.finished':
        return `review ${String(p.verdict ?? '')}`;
      case 'vcs.pr.opened':
        return `PR #${String(p.prNumber ?? '')} opened`;
      case 'git.pushed':
        return `pushed ${String(p.branch ?? '')}`;
      case 'progress.warning':
        return `${String(p.kind ?? 'note')}${p.evidence ? ` · ${String(p.evidence).slice(0, 80)}` : ''}`;
      default:
        return type;
    }
  }
}
