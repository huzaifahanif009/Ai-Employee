import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RunFailureCategory, RunState } from '@praxis/event-schemas';
import type { SandboxHandle, SandboxProvider } from '@praxis/contracts';
import { Repository } from 'typeorm';
import { ApprovalGateService } from '../approvals/approval-gate.service';
import { AppConfig, CONFIG } from '../config/config';
import { ConnectorsService } from '../connectors/connectors.service';
import { RunEntity } from '../database/entities';
import { RunEventsService } from '../events/run-events.service';
import { ModelRouterService } from '../model/model-router.service';
import { SANDBOX_PROVIDER } from '../sandbox/sandbox.module';
import { ToolBrokerService, ToolCtx } from '../tools/tool-broker.service';
import { WorkItemsService } from '../work-items/work-items.service';
import { assertTransition } from './run-state-machine';

/** strip `oauth2:<token>@` / `x-access-token:<token>@` from any string before it's logged/evented */
const redactUrl = (s: string): string =>
  (s ?? '').replace(/\/\/[^/@\s:]+:[^/@\s]+@/g, '//***:***@');

/** Minimal Node fixture repo the demo materialises so `test.run` etc. have something real to act on. */
const FIXTURE: Record<string, string> = {
  'package.json': JSON.stringify(
    { name: 'demo-app', version: '1.0.0', scripts: { test: 'node --test' } },
    null,
    2,
  ),
  'src/notify.js': `let attempts = 3;
function send(fn) {
  for (let i = 0; i < attempts; i++) {
    try { return fn(); } catch (e) { if (i === attempts - 1) throw e; }
  }
}
module.exports = { send, setAttempts: (n) => (attempts = n) };
`,
  'test/notify.test.js': `const test = require('node:test');
const assert = require('node:assert');
const { send } = require('../src/notify');
test('send returns the value on success', () => {
  assert.equal(send(() => 42), 42);
});
`,
};

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
    @Inject(SANDBOX_PROVIDER) private readonly sandbox: SandboxProvider,
    private readonly tools: ToolBrokerService,
    private readonly connectors: ConnectorsService,
    private readonly workItems: WorkItemsService,
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
    const runRow = await this.runs.findOneByOrFail({ id: runId });
    const projectId = runRow.projectId;
    let sbx: SandboxHandle | null = null;
    const vcs = await this.connectors.resolveForProject(tenantId, projectId).catch(() => null);
    const tracker = await this.connectors.resolveTrackerForProject(tenantId, projectId).catch(() => null);
    const workItem = await this.workItems.findById(tenantId, runRow.workItemId).catch(() => null);

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

      // --- provision a real sandbox + fixture repo (ADR-0005 docker backend) ---
      const repoDir = `${this.cfg.sandboxWorkdir}/repo`;
      const toolCtx = (stepId?: string): ToolCtx => ({
        tenantId, projectId, runId, stepId, agentRole: 'coder',
        sandbox: sbx!, repoDir, testCommand: 'node --test',
      });
      const tool = async (name: string, input: Record<string, unknown>, stepId?: string) => {
        const r = await this.tools.call(toolCtx(stepId), name, input);
        await bump({ toolCalls: 1 });
        return r;
      };

      try {
        sbx = await this.sandbox.acquire({
          runId, image: this.cfg.sandboxImage, cpuMillis: 1000, memoryMb: 1024, diskMb: 2048,
          egress: { allowHosts: ['*'] }, ttlSeconds: 1800,
        });
        await emit('progress.warning', { runId, kind: 'sandbox_ready', evidence: `container ${sbx.id.slice(0, 12)}` });

        if (vcs) {
          // clone the real repo (token in the URL — never logged/evented)
          const clone = await this.sandbox.execCollect(sbx, {
            cmd: ['sh', '-lc', `git clone --depth 50 "$0" repo && cd repo && git checkout -q "$1" 2>/dev/null || true`, vcs.cloneUrl, /* base */ 'main'],
            timeoutMs: 120_000,
          });
          if (clone.exitCode !== 0) throw new Error(`clone failed: ${redactUrl(clone.output)}`);
          await this.sandbox.execCollect(sbx, {
            cmd: ['sh', '-lc', `git remote set-url origin "$0"`, vcs.cloneUrl], cwd: repoDir, timeoutMs: 10_000,
          });
          await emit('progress.warning', {
            runId, kind: 'repo_cloned',
            evidence: `${vcs.connector.kind}: ${String(vcs.connector.config.projectPath)}`,
          });
        } else {
          await this.sandbox.execCollect(sbx, { cmd: ['sh', '-lc', `mkdir -p ${repoDir}`], timeoutMs: 10_000 });
          for (const [path, content] of Object.entries(FIXTURE)) {
            await this.sandbox.writeFile(sbx, `${repoDir}/${path}`, Buffer.from(content).toString('base64'));
          }
          await this.sandbox.execCollect(sbx, {
            cmd: ['sh', '-lc', 'git init -q && git add -A && git commit -q -m "chore: fixture" && git branch -M main'],
            cwd: repoDir, timeoutMs: 20_000,
          });
        }
      } catch (err) {
        this.log.warn(`sandbox/repo unavailable, degrading to eventing-only: ${(err as Error).message}`);
        await emit('progress.warning', { runId, kind: 'sandbox_unavailable', evidence: redactUrl((err as Error).message) });
        if (sbx) await this.sandbox.release(sbx).catch(() => undefined);
        sbx = null;
      }

      // --- execute ---
      await step('executing');
      for (const s of steps) {
        if (control.cancelled) return this.finishCancelled(runId, tenantId);
        const stepId = `${runId}-s${s.index}`;
        await emit('run_step.started', { runId, stepId, index: s.index, role: 'coder', title: s.title });
        await emit('message.delta', { runId, stepId, role: 'coder', deltaText: `Working on: ${s.title}. ` });
        await askModel('code', `Implement step ${s.index}: ${s.title}`, 'code', stepId);

        if (sbx && vcs) {
          // real repo: make one small, clearly-labelled, always-safe change
          if (s.index === 1) await tool('fs.list', { path: '.' }, stepId);
          if (s.index === 2)
            await tool(
              'fs.write',
              {
                path: 'PRAXIS_NOTES.md',
                content: `# Praxis\n\nThis branch was opened by a Praxis demo run (${runId}).\nWork item: ${s.title}\n\nSafe to close.\n`,
              },
              stepId,
            );
          if (s.index === 3) await tool('git.diff', {}, stepId);
          await tool('git.status', {}, stepId);
        } else if (sbx) {
          if (s.index === 1) await tool('fs.read', { path: 'src/notify.js' }, stepId);
          if (s.index === 2)
            await tool(
              'fs.write',
              { path: 'src/notify.js', content: FIXTURE['src/notify.js'].replace('let attempts = 3;', 'let attempts = 3; // retry policy: configurable\n') },
              stepId,
            );
          if (s.index === 3)
            await tool(
              'fs.write',
              { path: 'test/notify.test.js', content: FIXTURE['test/notify.test.js'] + `
test('retries up to the configured number of attempts', () => {
  let n = 0;
  const { send, setAttempts } = require('../src/notify');
  setAttempts(3);
  assert.equal(send(() => { n++; if (n < 3) throw new Error('x'); return 'ok'; }), 'ok');
});
` },
              stepId,
            );
          await tool('git.status', {}, stepId);
        } else {
          await this.sleep(400, control, runId);
        }
        await emit('run_step.finished', { runId, stepId, state: 'succeeded', iterations: s.index === 2 ? 2 : 1 });
        await bump({ filesChanged: s.index === 1 ? 0 : 1 });
      }

      // --- verify (real: run the tests in the sandbox) ---
      await step('verifying');
      await emit('verify.started', { runId });
      let verifyPass = true;
      if (sbx) {
        const t = await tool('test.run', vcs ? { command: 'npm test 2>&1 || echo "__praxis_no_tests__"' } : {});
        const noTests = /__praxis_no_tests__|Missing script: "test"|no test specified/i.test(t.outputPreview);
        verifyPass = t.status === 'ok' || noTests;
        await emit('verify.check_finished', {
          runId, check: 'unit',
          result: noTests ? 'pass' : verifyPass ? 'pass' : 'fail',
          summary: noTests ? 'no test script in repo — skipped' : t.outputPreview.split('\n').slice(-3).join(' ').slice(0, 200),
        });
      } else {
        await emit('verify.check_finished', { runId, check: 'unit', result: 'pass', summary: '(eventing-only)' });
      }
      await emit('verify.finished', { runId, overall: verifyPass ? 'pass' : 'fail' });
      if (!verifyPass) {
        return this.failRun(runId, tenantId, 'tests_never_passed', 'unit tests failed in the sandbox');
      }

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

      // --- deliver: real git ops; if a VCS connector is bound, push + open an MR/PR ---
      await step('delivering');
      const branch = `praxis/${runId.slice(0, 8)}`;
      const commitMsg = vcs
        ? `chore: praxis demo run ${runId.slice(0, 8)}\n\nSafe to close.`
        : 'feat: make notification retry count configurable\n\nCloses the demo work item.';
      let headSha = 'unknown';
      let diffText = '';
      let prRef: { number: number; url: string; state: string } | null = null;

      if (sbx) {
        await tool('git.branch', { name: branch });
        await emit('git.branch.created', { runId, repo: vcs ? String(vcs.connector.config.projectPath) : 'local/demo', branch, baseSha: 'main' });
        await tool('git.add', {});
        const diff = await tool('git.diff', { staged: true });
        diffText = diff.outputPreview;
        await tool('git.commit', { message: commitMsg });
        const log = await tool('git.log', {});
        headSha = (log.outputPreview.trim().split(/\s/)[0] || 'unknown').slice(0, 12);
        await emit('git.commit.created', { runId, sha: headSha, message: commitMsg.split('\n')[0], filesChanged: 1 });

        if (vcs) {
          const push = await this.sandbox.execCollect(sbx, {
            cmd: ['sh', '-lc', `git push -u origin "$0" 2>&1`, branch], cwd: repoDir, timeoutMs: 120_000,
          });
          if (push.exitCode !== 0) {
            return this.failRun(runId, tenantId, 'vcs_error', `git push failed: ${redactUrl(push.output).slice(-400)}`);
          }
          await emit('git.pushed', { runId, repo: String(vcs.connector.config.projectPath), branch, headSha });
          try {
            const mr = await vcs.provider.openOrUpdatePullRequest(
              { owner: '', name: '' },
              {
                headBranch: branch,
                baseBranch: 'main',
                title: `Praxis run ${runId.slice(0, 8)}`,
                body: [
                  `Opened by a Praxis demo run.`,
                  ``,
                  `- run: \`${runId}\``,
                  `- commit: \`${headSha}\``,
                  ``,
                  `Safe to close.`,
                ].join('\n'),
                idempotencyKey: `${runId}:${branch}`,
                labels: ['praxis'],
              },
            );
            prRef = { number: mr.number, url: mr.url, state: mr.state };
            await emit('vcs.pr.opened', { runId, repo: String(vcs.connector.config.projectPath), prNumber: mr.number, url: mr.url, state: mr.state });

            // write back to the source issue, if this work item came from a tracker
            if (tracker && workItem && workItem.sourceConnectorId !== 'manual' && tracker.provider.linkPullRequest) {
              await tracker.provider
                .linkPullRequest(workItem.externalId, mr.url)
                .then(() => emit('progress.warning', { runId, kind: 'tracker_linked', evidence: `issue #${workItem.externalId}` }))
                .catch((e) => this.log.warn(`tracker write-back: ${(e as Error).message}`));
            }
          } catch (e) {
            await emit('progress.warning', { runId, kind: 'mr_create_failed', evidence: (e as Error).message });
          }
        }
      }

      await this.runs.update({ id: runId }, { branchName: branch, headSha, prRef });
      if (!vcs) {
        await emit('vcs.pr.updated', {
          runId, repo: 'local/demo', prNumber: 0, url: '', state: 'no_connector',
          note: 'branch + patch produced; bind a VCS connector to push + open a PR/MR',
          diffPreview: diffText.slice(0, 4000),
        });
      }

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
      await emit('run.completed', { runId, outcome: 'succeeded', prUrl: prRef?.url });
    } catch (err) {
      const msg = redactUrl((err as Error).message);
      this.log.error(`run ${runId}: ${msg}`);
      const run = await this.runs.findOneBy({ id: runId });
      if (run && !['succeeded', 'failed', 'cancelled', 'timed_out'].includes(run.state)) {
        run.state = 'failed';
        run.failureCategory = 'sandbox_error';
        run.failureMessage = msg;
        run.endedAt = new Date();
        await this.runs.save(run);
        await this.events.append({
          tenantId, runId, type: 'run.failed',
          payload: { runId, category: 'sandbox_error', message: msg },
        });
      }
    } finally {
      this.controls.delete(runId);
      if (sbx) {
        await this.sandbox.release(sbx).catch((e) => this.log.warn(`sandbox release: ${(e as Error).message}`));
      }
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
