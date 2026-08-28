import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RunState } from '@praxis/event-schemas';
import { Repository } from 'typeorm';
import { RunEntity } from '../database/entities';
import { RunEventsService } from '../events/run-events.service';
import { assertTransition } from './run-state-machine';

interface Control {
  paused: boolean;
  cancelled: boolean;
}

/**
 * DEMO ONLY (RUN_DRIVER=inproc). Advances a Run through the real state machine emitting
 * a realistic event stream so the dashboard has something live to render in Phase 1 / M1.
 * In Phase 2 the Temporal `orchestrator` service replaces this entirely (ADR-0002).
 */
@Injectable()
export class InprocRunDriver {
  private readonly log = new Logger('InprocRunDriver');
  private controls = new Map<string, Control>();

  constructor(
    @InjectRepository(RunEntity) private readonly runs: Repository<RunEntity>,
    private readonly events: RunEventsService,
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

    try {
      // --- plan ---
      await step('planning');
      await this.sleep(600, control, runId);
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
      await bump({ tokens: 4200, costUsd: 0.012 });

      // --- execute ---
      await step('executing');
      for (const s of steps) {
        if (control.cancelled) return this.finishCancelled(runId, tenantId);
        const stepId = `${runId}-s${s.index}`;
        await emit('run_step.started', { runId, stepId, index: s.index, role: 'coder', title: s.title });
        await this.sleep(400, control, runId);
        await emit('message.delta', { runId, stepId, role: 'coder', deltaText: `Working on: ${s.title}. ` });
        await this.sleep(300, control, runId);
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
        await bump({ tokens: 9000, costUsd: 0.03, toolCalls: 1, filesChanged: 1 });
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
      await bump({ tokens: 1500, costUsd: 0.005 });

      // --- review ---
      await step('reviewing');
      await emit('review.started', { runId });
      await this.sleep(500, control, runId);
      await emit('review.finished', {
        runId, verdict: 'pass',
        findings: [{ severity: 'info', message: 'Retry count is configurable — good.' }],
      });
      await bump({ tokens: 6000, costUsd: 0.02 });

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
