import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { notFound, PraxisError } from '@praxis/contracts';
import { RunFailureCategory, RunState } from '@praxis/event-schemas';
import { Repository } from 'typeorm';
import { AppConfig, CONFIG } from '../config/config';
import { ModelCallEntity, RunEntity, ToolCallEntity, WorkItemEntity } from '../database/entities';
import { RunEventsService } from '../events/run-events.service';
import { RequestContext } from '../common/request-context';
import { assertTransition, isTerminal } from './run-state-machine';
import { InprocRunDriver } from './inproc-run-driver';

export interface StartRunInput {
  workItemId: string;
  projectId?: string;
  budgetOverride?: Record<string, number>;
  priority?: 'low' | 'normal' | 'high';
}

@Injectable()
export class RunsService {
  private readonly log = new Logger('Runs');

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectRepository(RunEntity) private readonly runs: Repository<RunEntity>,
    @InjectRepository(WorkItemEntity) private readonly workItems: Repository<WorkItemEntity>,
    @InjectRepository(ModelCallEntity) private readonly modelCalls: Repository<ModelCallEntity>,
    @InjectRepository(ToolCallEntity) private readonly toolCalls: Repository<ToolCallEntity>,
    private readonly events: RunEventsService,
    private readonly inproc: InprocRunDriver,
  ) {}

  /** Per-step drill-down: the plan step + every model/tool call attributed to it. */
  async steps(tenantId: string, id: string) {
    const run = await this.get(tenantId, id);
    const [mcs, tcs] = await Promise.all([
      this.modelCalls.find({ where: { runId: id }, order: { createdAt: 'ASC' } }),
      this.toolCalls.find({ where: { tenantId, runId: id }, order: { seq: 'ASC' } }),
    ]);

    const mcView = (m: ModelCallEntity) => ({
      purpose: m.purpose,
      provider: m.provider,
      model: m.model,
      agentRole: m.agentRole,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      costUsd: Number(m.costUsd),
      latencyMs: m.latencyMs,
      cacheHit: m.cacheHit,
      finishReason: m.finishReason,
      createdAt: m.createdAt,
    });
    const tcView = (t: ToolCallEntity) => ({
      seq: t.seq,
      toolName: t.toolName,
      riskTier: t.riskTier,
      status: t.status,
      input: t.input,
      outputPreview: t.outputPreview,
      durationMs: t.durationMs,
      error: t.error,
      createdAt: t.createdAt,
    });

    const planSteps = run.plan?.steps ?? [];
    const byStep = (sid: string) => ({
      modelCalls: mcs.filter((m) => m.runStepId === sid).map(mcView),
      toolCalls: tcs.filter((t) => t.runStepId === sid).map(tcView),
    });

    const steps = planSteps.map((s) => {
      const sid = `${id}-s${s.index}`;
      const g = byStep(sid);
      return {
        index: s.index,
        title: s.title,
        rationale: s.rationale ?? '',
        files: s.files,
        kind: s.kind,
        state: s.state ?? 'pending',
        filesWritten: s.filesWritten ?? [],
        modelCalls: g.modelCalls,
        toolCalls: g.toolCalls,
        costUsd: +g.modelCalls.reduce((a, m) => a + m.costUsd, 0).toFixed(6),
        tokens: g.modelCalls.reduce((a, m) => a + m.inputTokens + m.outputTokens, 0),
      };
    });

    const assignedStepIds = new Set(planSteps.map((s) => `${id}-s${s.index}`));
    const orphanModel = mcs.filter((m) => !m.runStepId || !assignedStepIds.has(m.runStepId)).map(mcView);
    const orphanTool = tcs.filter((t) => !t.runStepId || !assignedStepIds.has(t.runStepId)).map(tcView);

    return {
      runId: id,
      plan: run.plan,
      steps,
      other: { modelCalls: orphanModel, toolCalls: orphanTool },
    };
  }

  async list(
    tenantId: string,
    filter: { projectId?: string; workItemId?: string; state?: string[]; limit?: number; cursor?: string },
  ) {
    const limit = Math.min(filter.limit ?? 50, 200);
    const qb = this.runs
      .createQueryBuilder('r')
      .where('r.tenantId = :tenantId', { tenantId })
      .orderBy('r.createdAt', 'DESC')
      .take(limit + 1);
    if (filter.projectId) qb.andWhere('r.projectId = :projectId', { projectId: filter.projectId });
    if (filter.workItemId) qb.andWhere('r.workItemId = :workItemId', { workItemId: filter.workItemId });
    if (filter.state?.length) qb.andWhere('r.state IN (:...state)', { state: filter.state });
    if (filter.cursor) qb.andWhere('r.createdAt < :cursor', { cursor: new Date(filter.cursor) });
    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return {
      data,
      nextCursor: hasMore ? data[data.length - 1].createdAt.toISOString() : null,
    };
  }

  async get(tenantId: string, id: string) {
    const r = await this.runs.findOne({ where: { id, tenantId } });
    if (!r) throw notFound('Run', { id });
    return r;
  }

  findByBranch(tenantId: string, branchName: string) {
    return this.runs.findOne({
      where: { tenantId, branchName },
      order: { createdAt: 'DESC' },
    });
  }

  async listEvents(tenantId: string, id: string, afterSeq = 0, limit = 200) {
    await this.get(tenantId, id);
    return this.events.since(id, afterSeq, limit);
  }

  async start(ctx: RequestContext, input: StartRunInput) {
    const wi = await this.workItems.findOne({
      where: { id: input.workItemId, tenantId: ctx.tenantId },
    });
    if (!wi) throw notFound('WorkItem', { id: input.workItemId });

    const seq =
      (await this.runs.count({ where: { workItemId: wi.id } })) + 1;

    const run = await this.runs.save(
      this.runs.create({
        tenantId: ctx.tenantId,
        projectId: input.projectId ?? wi.projectId,
        workItemId: wi.id,
        seq,
        state: 'queued',
        budgetSnapshot: input.budgetOverride ?? {},
        createdBy: ctx.userId,
      }),
    );

    wi.state = 'in_progress';
    await this.workItems.save(wi);

    await this.events.append({
      tenantId: ctx.tenantId,
      runId: run.id,
      type: 'run.created',
      payload: {
        runId: run.id,
        workItemId: wi.id,
        projectId: run.projectId,
        title: wi.title,
      },
      actor: { kind: 'user', id: ctx.userId },
    });

    if (this.cfg.runDriver === 'inproc') {
      this.inproc.drive(run.id, ctx.tenantId).catch((e) =>
        this.log.error(`inproc driver for run ${run.id} failed: ${(e as Error).message}`),
      );
    } else {
      this.log.warn(
        `RUN_DRIVER=temporal: run ${run.id} left 'queued' — the orchestrator service owns advancement (Phase 2 wiring).`,
      );
    }
    return run;
  }

  /** Used by the driver / orchestrator to move state and emit the transition event. */
  async transition(
    tenantId: string,
    id: string,
    to: RunState,
    extra: {
      failureCategory?: RunFailureCategory;
      failureMessage?: string;
      patch?: Partial<RunEntity>;
      actor?: { kind: 'user' | 'service' | 'agent' | 'system'; id: string };
    } = {},
  ) {
    const run = await this.get(tenantId, id);
    assertTransition(run.state, to);
    const from = run.state;
    run.state = to;
    if (!run.startedAt && to !== 'queued') run.startedAt = new Date();
    if (isTerminal(to)) run.endedAt = new Date();
    if (extra.failureCategory) run.failureCategory = extra.failureCategory;
    if (extra.failureMessage) run.failureMessage = extra.failureMessage;
    if (extra.patch) Object.assign(run, extra.patch);
    await this.runs.save(run);

    await this.events.append({
      tenantId,
      runId: id,
      type: 'run.state_changed',
      payload: { runId: id, from, to },
      actor: extra.actor ?? { kind: 'system', id: 'orchestrator' },
    });
    if (to === 'failed') {
      await this.events.append({
        tenantId,
        runId: id,
        type: 'run.failed',
        payload: { runId: id, category: run.failureCategory, message: run.failureMessage },
      });
    }
    if (to === 'succeeded') {
      await this.events.append({
        tenantId,
        runId: id,
        type: 'run.completed',
        payload: { runId: id, outcome: 'succeeded', prUrl: run.prRef?.url },
      });
    }
    return run;
  }

  async bumpTotals(tenantId: string, id: string, delta: Partial<RunEntity['totals']>) {
    const run = await this.get(tenantId, id);
    run.totals = {
      tokens: run.totals.tokens + (delta.tokens ?? 0),
      costUsd: +(run.totals.costUsd + (delta.costUsd ?? 0)).toFixed(6),
      toolCalls: run.totals.toolCalls + (delta.toolCalls ?? 0),
      filesChanged: run.totals.filesChanged + (delta.filesChanged ?? 0),
      wallMs: run.totals.wallMs + (delta.wallMs ?? 0),
    };
    await this.runs.save(run);
    await this.events.append({
      tenantId,
      runId: id,
      type: 'run.totals_updated',
      payload: { runId: id, ...run.totals },
    });
  }

  async control(
    ctx: RequestContext,
    id: string,
    op: 'pause' | 'resume' | 'cancel' | 'comment',
    body: { reason?: string; text?: string } = {},
  ) {
    const run = await this.get(ctx.tenantId, id);
    if (isTerminal(run.state)) {
      throw new PraxisError('CONFLICT', `Run already ${run.state}`, 409);
    }
    switch (op) {
      case 'pause':
        await this.events.append({
          tenantId: ctx.tenantId,
          runId: id,
          type: 'run.paused',
          payload: { runId: id, reason: body.reason ?? 'operator' },
          actor: { kind: 'user', id: ctx.userId },
        });
        this.inproc.pause(id);
        return { ok: true };
      case 'resume':
        await this.events.append({
          tenantId: ctx.tenantId,
          runId: id,
          type: 'run.resumed',
          payload: { runId: id },
          actor: { kind: 'user', id: ctx.userId },
        });
        this.inproc.resume(id);
        return { ok: true };
      case 'comment':
        await this.events.append({
          tenantId: ctx.tenantId,
          runId: id,
          type: 'operator.message',
          payload: { runId: id, from: ctx.userId, text: body.text ?? '' },
          actor: { kind: 'user', id: ctx.userId },
        });
        return { ok: true };
      case 'cancel':
        this.inproc.cancel(id);
        await this.transition(ctx.tenantId, id, 'cancelled', {
          failureCategory: 'cancelled',
          actor: { kind: 'user', id: ctx.userId },
        });
        return { ok: true };
    }
  }
}
