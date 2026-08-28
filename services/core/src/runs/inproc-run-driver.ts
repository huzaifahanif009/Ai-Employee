import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RunFailureCategory, RunState } from '@praxis/event-schemas';
import { Repository } from 'typeorm';
import { ApprovalGateService } from '../approvals/approval-gate.service';
import { AppConfig, CONFIG } from '../config/config';
import { RunEntity } from '../database/entities';
import { RunEventsService } from '../events/run-events.service';
import { ModelRouterService } from '../model/model-router.service';
import { assertTransition } from './run-state-machine';

interface Control {
  paused: boolean;
  cancelled: boolean;
}

/**
 * DEMO ONLY (RUN_DRIVER=inproc). Advances a Run through the real state machine emitting
 * a realistic event stream so the dashboard has something live to render in Phase 1 / M1.
 * Human-in-the-loop gates (prd/06 §5) are real: it raises an Approval through
 * `ApprovalGateService` and blocks on it exactly as a Temporal-driven Run would signal.
 * In Phase 2 the Temporal `orchestrator` service replaces the *advancement* (not the gate) —
 * see ADR-0002.
 */
@Injectable()
export class InprocRunDriver {
  private readonly log = new Logger('InprocRunDriver');
  private controls = new Map<string, Control>();

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectRepository(RunEntity) private readonly runs: Repository<RunEntity>,
    private readonly events: RunEventsService,
    private readonly approvalGate: ApprovalGateService,
    private readonly modelRouter: ModelRouterService,
  ) {}

  pause(runId: string) {
    const c = this.controls.get(runId);
    if (c) c.paused = true;
  }
  resume(runId: string) {
    const c = this.controls.get(runId);
    if (c) c.paused = false;
  }
  cancel(runId: string) {
    const c = this.controls.get(runId);
    if (c) c.cancelled = true;
  }

  async drive(runId: string, tenantId: string): Promise<void> {
    const control: Control = { paused: false, cancelled: false };
    this.controls.set(runId, control);
    const t0 = Date.now();
    const projectId = (await this.runs.findOneByOrFail({ id: runId })).projectId;

    const step = async (to: RunState) => {
      await this.gate(control, runId);
      const run = await this.runs.findOneByOrFail({ id: runId });
      assertTransition(run.state, to);
      run.state = to;
      if (!run.startedAt) run.startedAt = new Date();
      await this.runs.save(run);
      await this.events.append({
        tenantId,
        runId,
        type: 'run.state_changed',
        payload: { runId, from: run.state === to ? undefined : run.state, to },
        actor: { kind: 'system', id: 'inproc-driver' },
      });
    };

    const emit = (type: string, payload: Record<string, unknown>) =>
      this.events.append({ tenantId, runId, type, payload, actor: { kind: 'agent', id: 'demo' } });

    const bump = async (delta: Partial<RunEntity['totals']>) => {
      const run = await this.runs.findOneByOrFail({ id: runId });
      run.totals = {
        tokens: run.totals.tokens + (delta.tokens ?? 0),
        costUsd: +(run.totals.costUsd + (delta.costUsd ?? 0)).toFixed(6),
        toolCalls: run.totals.toolCalls + (delta.toolCalls ?? 0),
        filesChanged: run.totals.filesChanged + (delta.filesChanged ?? 0),
        wallMs: Date.now() - t0,
      };
      await this.runs.save(run);
      await emit('run.totals_updated', { runId, ...run.totals });
    };

    /**
     * Real metered call through the Model Router (→ LiteLLM). With no provider keys this
     * routes to the always-on `praxis-stub` model (cost $0), but the call, the ledger row,
     * the `model_call.*` events and the token accounting are all genuine.
     */
    const askModel = async (
      purpose: 'triage' | 'plan' | 'code' | 'review',
      prompt: string,
      routingClass: 'fast' | 'strong' | 'code',
      stepId?: string,
    ) => {
      try {
        const res = await this.modelRouter.complete({
          purpose,
          routingClass,
          messages: [
            { role: 'system', content: [{ type: 'text', text: 'You are a Praxis agent (demo driver).' }] },
            { role: 'user', content: [{ type: 'text', text: prompt }] },
          ],
          maxOutputTokens: 256,
          attribution: { tenantId, projectId, runId, stepId, agentRole: purpose === 'review' ? 'reviewer' : purpose === 'plan' ? 'planner' : 'coder' },
        });
        await bump({ tokens: res.usage.inputTokens + res.usage.outputTokens, costUsd: res.usage.costUsd });
        return res;
      } catch (err) {
        this.log.warn(`model call (${purpose}) failed: ${(err as Error).message}`);
        await emit('progress.warning', { runId, stepId, kind: 'model_call_failed', evidence: (err as Error).message });
        return null;
      }
    };

    try {
      // --- triage + plan ---
      await step('planning');
      await askModel('triage', 'Classify this work item and assess readiness.', 'fast');
      await this.sleep(300, control, runId);
      await askModel('plan', 'Produce an ordered implementation plan for the work item.', 'strong');
      await this.sleep(300, control, runId);
      const steps = [
        { index: 1, title: 'Inspect existing notification code', files: ['src/notifications/service.ts'] },
        { index: 2, title: 'Add retry policy with backoff', files: ['src/notifications/service.ts'] },
        { index: 3, title: 'Add unit test for retry behaviour', files: ['src/notifications/service.spec.ts'] },
      ];
      await emit('plan.created', {
        runId,
        planId: `plan-${runId}`,
        version: 1,
        stepCount: steps.length,
        filesEstimate: steps.flatMap((s) => s.files),
        risk: 'medium',
      });
      for (const s of steps) {
        await emit('plan.step_defined', { planId: `plan-${runId}`, index: s.index, title: s.title, riskTier: 'notify' });
        await this.sleep(120, control, runId);
      }

      // --- plan approval gate (real HITL — prd/06 §5, FR-PLAN-4) ---
      if (this.cfg.requirePlanApproval) {
        await step('awaiting_plan_approval');
        const decision = await this.approvalGate.raiseAndWait({
          tenantId,
          runId,
          type: 'plan',
          evidence: {
            summary: `${steps.length}-step plan touching ${[...new Set(steps.flatMap((s) => s.files))].join(', ')}`,
            steps: steps.map((s) => ({ index: s.index, title: s.title })),
            risk: 'medium',
          },
          actionPreview: { action: 'execute_plan', stepCount: steps.length },
        });
        if (control.cancelled) return this.finishCancelled(runId, tenantId);
        if (decision.decision === 'reject') {
          return this.failRun(runId, tenantId, 'plan_rejected', decision.note ?? 'Plan rejected by reviewer');
        }
      }

      // --- execute ---
      await step('executing');
      for (const s of steps) {
        if (control.cancelled) return this.finishCancelled(runId, tenantId);
        const stepId = `${runId}-s${s.index}`;
        await emit('run_step.started', { runId, stepId, index: s.index, role: 'coder', title: s.title });
        await this.sleep(200, control, runId);
        await emit('message.delta', { runId, stepId, role: 'coder', deltaText: `Working on: ${s.title}. ` });
        await askModel('code', `Implement step ${s.index}: ${s.title}`, 'code', stepId);
        await this.sleep(200, control, runId);
        const tcId = `${stepId}-tc1`;
        await emit('tool_call.started', {
          runId, stepId, toolCallId: tcId, tool: s.index === 3 ? 'test.run' : 'fs.patch',
          argsPreview: s.files[0], riskTier: 'notify',
        });
        await this.sleep(500, control, runId);
        await emit('tool_call.finished', {
          runId, stepId, toolCallId: tcId,
          status: 'ok', durationMs: 480, bytesOut: 512,
          outputPreview: s.index === 3 ? '3 passing' : `+18 -4 ${s.files[0]}`,
        });
        await emit('run_step.finished', { runId, stepId, state: 'succeeded', iterations: s.index === 2 ? 2 : 1 });
        await bump({ toolCalls: 1, filesChanged: 1 });
      }

      // --- verify ---
      await step('verifying');
      await emit('verify.started', { runId });
      for (const check of ['build', 'lint', 'unit'] as const) {
        await emit('verify.check_started', { runId, check });
        await this.sleep(400, control, runId);
        await emit('verify.check_finished', {
          runId, check, result: 'pass',
          summary: check === 'unit' ? '143 passed' : 'ok',
        });
      }
      await emit('verify.finished', { runId, overall: 'pass', coverageDelta: 0.4 });

      // --- review ---
      await step('reviewing');
      await emit('review.started', { runId });
      await askModel('review', 'Review the final diff against the acceptance criteria.', 'strong');
      await this.sleep(300, control, runId);
      await emit('review.finished', {
        runId, verdict: 'pass',
        findings: [{ severity: 'info', message: 'Retry count is configurable — good.' }],
      });

      // --- delivery approval gate (real HITL — prd/06 §5, FR-DELIVER-3) ---
      if (this.cfg.requireDeliveryApproval) {
        await step('awaiting_delivery_approval');
        const decision = await this.approvalGate.raiseAndWait({
          tenantId,
          runId,
          type: 'delivery',
          evidence: { summary: 'Verification passed, review verdict: pass.' },
          actionPreview: { action: 'open_pr', repo: 'demo/app', base: 'main' },
        });
        if (control.cancelled) return this.finishCancelled(runId, tenantId);
        if (decision.decision === 'reject') {
          return this.failRun(runId, tenantId, 'policy_block', decision.note ?? 'Delivery rejected by reviewer');
        }
      }

      // --- deliver ---
      await step('delivering');
      const branch = `praxis/demo-${runId.slice(0, 8)}`;
      await emit('git.branch.created', { runId, repo: 'demo/app', branch, baseSha: 'deadbeef' });
      await emit('git.commit.created', { runId, sha: 'cafef00d', message: 'feat: add notification retry policy', filesChanged: 3 });
      await emit('git.pushed', { runId, repo: 'demo/app', branch, headSha: 'cafef00d' });
      const pr = { number: 1, url: `http://localhost:3001/demo/app/pulls/1`, state: 'open' as const };
      await this.runs.update({ id: runId }, { branchName: branch, headSha: 'cafef00d', prRef: pr });
      await emit('vcs.pr.opened', { runId, repo: 'demo/app', prNumber: pr.number, url: pr.url, state: 'open' });

      // --- done ---
      const run = await this.runs.findOneByOrFail({ id: runId });
      run.state = 'succeeded';
      run.endedAt = new Date();
      await this.runs.save(run);
      await this.events.append({
        tenantId, runId, type: 'run.state_changed',
        payload: { runId, from: 'delivering', to: 'succeeded' },
        actor: { kind: 'system', id: 'inproc-driver' },
      });
      await emit('run.completed', { runId, outcome: 'succeeded', prUrl: pr.url });
    } catch (err) {
      this.log.error(`run ${runId}: ${(err as Error).message}`);
      const run = await this.runs.findOneBy({ id: runId });
      if (run && !['succeeded', 'failed', 'cancelled', 'timed_out'].includes(run.state)) {
        run.state = 'failed';
        run.failureCategory = 'sandbox_error';
        run.failureMessage = (err as Error).message;
        run.endedAt = new Date();
        await this.runs.save(run);
        await this.events.append({
          tenantId, runId, type: 'run.failed',
          payload: { runId, category: 'sandbox_error', message: (err as Error).message },
        });
      }
    } finally {
      this.controls.delete(runId);
    }
  }

  private async failRun(
    runId: string,
    tenantId: string,
    category: RunFailureCategory,
    message: string,
  ) {
    const run = await this.runs.findOneBy({ id: runId });
    if (run && !['succeeded', 'failed', 'cancelled', 'timed_out'].includes(run.state)) {
      run.state = 'failed';
      run.failureCategory = category;
      run.failureMessage = message;
      run.endedAt = new Date();
      await this.runs.save(run);
      await this.events.append({
        tenantId, runId, type: 'run.state_changed',
        payload: { runId, to: 'failed' },
      });
      await this.events.append({
        tenantId, runId, type: 'run.failed',
        payload: { runId, category, message },
      });
    }
  }

  private async finishCancelled(runId: string, tenantId: string) {
    const run = await this.runs.findOneBy({ id: runId });
    if (run && !['succeeded', 'failed', 'cancelled', 'timed_out'].includes(run.state)) {
      run.state = 'cancelled';
      run.failureCategory = 'cancelled';
      run.endedAt = new Date();
      await this.runs.save(run);
      await this.events.append({
        tenantId, runId, type: 'run.state_changed',
        payload: { runId, to: 'cancelled' },
      });
    }
  }

  private async gate(control: Control, runId: string) {
    if (control.cancelled) throw new Error('cancelled');
    while (control.paused) {
      await this.sleep(250, control, runId, true);
      if (control.cancelled) throw new Error('cancelled');
    }
  }

  private sleep(ms: number, control?: Control, _runId?: string, ignorePause = false) {
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        if (control?.cancelled) return resolve();
        if (control?.paused && !ignorePause) return resolve();
        resolve();
      }, ms);
    });
  }
}
