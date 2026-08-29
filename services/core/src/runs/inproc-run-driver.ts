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
import {
  AgentStep,
  CoderAgentService,
  RepoIo,
  type AskFn,
} from './coder-agent.service';
import { assertTransition } from './run-state-machine';

/** strip `oauth2:<token>@` / `x-access-token:<token>@` from any string before it's logged/evented */
const redactUrl = (s: string): string =>
  (s ?? '').replace(/\/\/[^/@\s:]+:[^/@\s]+@/g, '//***:***@');

interface Control {
  paused: boolean;
  cancelled: boolean;
}

/**
 * In-process Run driver (RUN_DRIVER=inproc). Advances a Run through the real
 * state machine while doing **real work**: it provisions a sandbox, clones the
 * bound repository, and uses the tenant's model (via the Model Router) to plan
 * the work, write real files, run the tests, review the diff, and open a PR/MR
 * for a human to merge. The plan is editable at the approval gate.
 *
 * In Phase 2 the Temporal `orchestrator` replaces this as the *advancer* — the
 * gates, model calls, tool calls and VCS delivery carry over unchanged.
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
    private readonly coder: CoderAgentService,
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
    if (!workItem) return this.failRun(runId, tenantId, 'sandbox_error', 'work item not found');

    const wi = {
      title: workItem.title,
      bodyMd: workItem.bodyMd,
      acceptanceCriteria: workItem.acceptanceCriteria,
    };

    const step = async (to: RunState) => {
      await this.gate(control, runId);
      const run = await this.runs.findOneByOrFail({ id: runId });
      assertTransition(run.state, to);
      const from = run.state;
      run.state = to;
      if (!run.startedAt) run.startedAt = new Date();
      await this.runs.save(run);
      await this.events.append({
        tenantId,
        runId,
        type: 'run.state_changed',
        payload: { runId, from: from === to ? undefined : from, to },
        actor: { kind: 'system', id: 'inproc-driver' },
      });
    };

    const emit = (type: string, payload: Record<string, unknown>) =>
      this.events.append({ tenantId, runId, type, payload, actor: { kind: 'agent', id: 'coder' } });

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

    /** one metered model call through the Model Router; returns the reply text */
    const ask: AskFn = async ({ purpose, routingClass, system, user, maxOutputTokens, json, stepId }) => {
      try {
        const res = await this.modelRouter.complete({
          purpose,
          routingClass,
          messages: [
            { role: 'system', content: [{ type: 'text', text: system }] },
            { role: 'user', content: [{ type: 'text', text: user }] },
          ],
          maxOutputTokens: maxOutputTokens ?? 2048,
          responseFormat: json ? 'json' : 'text',
          attribution: {
            tenantId,
            projectId,
            runId,
            stepId,
            agentRole: purpose === 'review' ? 'reviewer' : purpose === 'plan' ? 'planner' : 'coder',
          },
        });
        await bump({
          tokens: res.usage.inputTokens + res.usage.outputTokens,
          costUsd: res.usage.costUsd,
        });
        return res.content.map((p) => ('text' in p ? p.text : '')).join('');
      } catch (err) {
        this.log.warn(`model call (${purpose}) failed: ${(err as Error).message}`);
        await emit('progress.warning', { runId, stepId, kind: 'model_call_failed', evidence: (err as Error).message });
        return '';
      }
    };

    const repoDir = `${this.cfg.sandboxWorkdir}/repo`;
    const toolCtx = (stepId?: string): ToolCtx => ({
      tenantId, projectId, runId, stepId, agentRole: 'coder', sandbox: sbx!, repoDir,
    });
    const tool = async (name: string, input: Record<string, unknown>, stepId?: string) => {
      const r = await this.tools.call(toolCtx(stepId), name, input);
      await bump({ toolCalls: 1 });
      return r;
    };
    const io: RepoIo = {
      listFiles: async () =>
        (await tool('shell.exec', {
          command: 'git ls-files 2>/dev/null || find . -type f -not -path "./.git/*" | sed "s|^\\./||"',
        })).outputPreview,
      readFile: async (p) => {
        const r = await tool('fs.read', { path: p });
        return r.status === 'ok' ? r.outputPreview : null;
      },
      sh: async (command) => {
        const r = await tool('shell.exec', { command });
        return { ok: r.status === 'ok', output: r.outputPreview };
      },
    };

    try {
      // ── provision sandbox + clone ─────────────────────────────────────────
      await step('planning');
      try {
        sbx = await this.sandbox.acquire({
          runId, image: this.cfg.sandboxImage, cpuMillis: 2000, memoryMb: 2048, diskMb: 4096,
          egress: { allowHosts: ['*'] }, ttlSeconds: 1800,
        });
        await emit('progress.warning', { runId, kind: 'sandbox_ready', evidence: `container ${sbx.id.slice(0, 12)}` });

        if (vcs) {
          const clone = await this.sandbox.execCollect(sbx, {
            cmd: ['sh', '-lc', `git clone --depth 50 "$0" repo && cd repo && git checkout -q "$1" 2>/dev/null || true`, vcs.cloneUrl, 'main'],
            timeoutMs: 120_000,
          });
          if (clone.exitCode !== 0) throw new Error(`clone failed: ${redactUrl(clone.output)}`);
          await this.sandbox.execCollect(sbx, {
            cmd: ['sh', '-lc', `git remote set-url origin "$0" && git config user.email praxis@local && git config user.name Praxis`, vcs.cloneUrl],
            cwd: repoDir, timeoutMs: 10_000,
          });
          await emit('progress.warning', {
            runId, kind: 'repo_cloned', evidence: `${vcs.connector.kind}: ${String(vcs.connector.config.projectPath)}`,
          });
        } else {
          await this.sandbox.execCollect(sbx, {
            cmd: ['sh', '-lc', `mkdir -p ${repoDir} && cd ${repoDir} && git init -q && git config user.email praxis@local && git config user.name Praxis && git commit -q --allow-empty -m "chore: init" && git branch -M main`],
            timeoutMs: 20_000,
          });
        }
      } catch (err) {
        return this.failRun(runId, tenantId, 'sandbox_error', `could not prepare a workspace: ${redactUrl((err as Error).message)}`);
      }

      // ── analyse + plan ───────────────────────────────────────────────────
      const repoCtx = await this.coder.analyzeRepo(io);
      await emit('progress.warning', {
        runId, kind: 'repo_analysed',
        evidence: `stack=${repoCtx.stack} files=${repoCtx.fileTree.length}${repoCtx.greenfield ? ' greenfield' : ''}`,
      });

      const plan = await this.coder.plan(ask, wi, repoCtx);
      let steps: AgentStep[] = plan.steps;
      await emit('plan.created', {
        runId,
        planId: `plan-${runId}`,
        version: 1,
        stepCount: steps.length,
        summary: plan.summary,
        filesEstimate: [...new Set(steps.flatMap((s) => s.files))],
        risk: plan.risk,
      });
      for (const s of steps) {
        await emit('plan.step_defined', {
          planId: `plan-${runId}`, index: s.index, title: s.title, files: s.files, kind: s.kind, riskTier: 'notify',
        });
      }

      // ── plan approval gate (editable) ────────────────────────────────────
      if (this.cfg.requirePlanApproval) {
        await step('awaiting_plan_approval');
        const decision = await this.approvalGate.raiseAndWait({
          tenantId,
          runId,
          type: 'plan',
          evidence: {
            summary: plan.summary,
            risk: plan.risk,
            greenfield: repoCtx.greenfield,
            steps: steps.map((s) => ({ index: s.index, title: s.title, rationale: s.rationale, files: s.files, kind: s.kind })),
          },
          actionPreview: { action: 'execute_plan', stepCount: steps.length, editable: true },
        });
        if (control.cancelled) return this.finishCancelled(runId, tenantId);
        if (decision.decision === 'reject') {
          return this.failRun(runId, tenantId, 'plan_rejected', decision.note ?? 'Plan rejected by reviewer');
        }
        const edited = (decision.payload as { editedPlan?: unknown } | undefined)?.editedPlan;
        if (edited) {
          const next = this.coder.sanitizePlan(edited);
          if (next.length) {
            steps = next;
            await emit('progress.warning', { runId, kind: 'plan_edited', evidence: `${steps.length} steps after human edit` });
          }
        }
      }

      // ── execute ─────────────────────────────────────────────────────────
      await step('executing');
      const changed = new Set<string>();
      for (const s of steps) {
        if (control.cancelled) return this.finishCancelled(runId, tenantId);
        const stepId = `${runId}-s${s.index}`;
        await emit('run_step.started', { runId, stepId, index: s.index, role: 'coder', title: s.title });

        const files = await this.coder.implementStep(ask, io, s, wi, repoCtx);
        let wrote = 0;
        for (const f of files) {
          if (f.action === 'delete') {
            const r = await tool('shell.exec', { command: `rm -f ${shq(f.path)}` }, stepId);
            if (r.status === 'ok') { changed.add(f.path); wrote++; }
            continue;
          }
          const r = await tool('fs.write', { path: f.path, content: f.content }, stepId);
          if (r.status === 'ok') { changed.add(f.path); wrote++; }
          else await emit('progress.warning', { runId, stepId, kind: 'write_rejected', evidence: `${f.path}: ${r.outputPreview}` });
        }
        await emit('message.delta', {
          runId, stepId, role: 'coder',
          deltaText: wrote ? `${s.title} — wrote ${files.map((f) => f.path).join(', ')}. ` : `${s.title} — no file changes. `,
        });
        await tool('git.add', {}, stepId);
        await emit('run_step.finished', { runId, stepId, state: wrote ? 'succeeded' : 'no_changes', filesWritten: wrote });
      }
      await bump({ filesChanged: changed.size });

      if (changed.size === 0) {
        return this.failRun(runId, tenantId, 'sandbox_error', 'the agent produced no file changes for this work item');
      }

      // ── verify ─────────────────────────────────────────────────────────
      await step('verifying');
      await emit('verify.started', { runId });
      let verifyOk = true;
      let verifySummary = 'no test command detected — skipped';
      if (repoCtx.testCommand) {
        const install =
          repoCtx.stack === 'node'
            ? 'if [ -f package.json ] && [ ! -d node_modules ]; then npm install --no-audit --no-fund --silent || true; fi'
            : 'true';
        await tool('shell.exec', { command: install });
        let t = await tool('test.run', { command: `${repoCtx.testCommand} 2>&1` });
        const noTests = /no tests? (found|specified)|Missing script|0 passing/i.test(t.outputPreview);
        verifyOk = t.status === 'ok' || noTests;

        if (!verifyOk) {
          // one repair round
          await emit('progress.warning', { runId, kind: 'verify_failed_retry', evidence: tail(t.outputPreview) });
          const failStep: AgentStep = {
            index: steps.length + 1,
            title: 'Fix failing tests',
            rationale: `Tests failed:\n${tail(t.outputPreview, 1500)}`,
            files: [...changed],
            kind: 'edit',
          };
          const fixes = await this.coder.implementStep(ask, io, failStep, wi, repoCtx);
          for (const f of fixes) {
            const r = await tool('fs.write', { path: f.path, content: f.content }, `${runId}-fix`);
            if (r.status === 'ok') changed.add(f.path);
          }
          await tool('git.add', {});
          t = await tool('test.run', { command: `${repoCtx.testCommand} 2>&1` });
          verifyOk = t.status === 'ok' || /no tests? (found|specified)|Missing script/i.test(t.outputPreview);
        }
        verifySummary = verifyOk ? 'tests pass' : `tests failing:\n${tail(t.outputPreview)}`;
      }
      await emit('verify.check_finished', { runId, check: 'tests', result: verifyOk ? 'pass' : 'fail', summary: verifySummary.slice(0, 300) });
      await emit('verify.finished', { runId, overall: verifyOk ? 'pass' : 'fail' });

      // ── review ─────────────────────────────────────────────────────────
      await step('reviewing');
      await emit('review.started', { runId });
      const diffRes = await tool('git.diff', { staged: true });
      const diff = diffRes.outputPreview;
      const review = await this.coder.review(ask, wi, diff);
      await emit('review.finished', { runId, verdict: review.verdict, summary: review.summary, findings: review.findings });

      // ── delivery approval gate ─────────────────────────────────────────
      if (this.cfg.requireDeliveryApproval) {
        await step('awaiting_delivery_approval');
        const decision = await this.approvalGate.raiseAndWait({
          tenantId, runId, type: 'delivery',
          evidence: { summary: `verify: ${verifyOk ? 'pass' : 'fail'} · review: ${review.verdict}`, files: [...changed] },
          actionPreview: { action: 'open_pr', repo: vcs ? String(vcs.connector.config.projectPath) : 'local', base: 'main' },
        });
        if (control.cancelled) return this.finishCancelled(runId, tenantId);
        if (decision.decision === 'reject') {
          return this.failRun(runId, tenantId, 'policy_block', decision.note ?? 'Delivery rejected by reviewer');
        }
      }

      // ── deliver ────────────────────────────────────────────────────────
      await step('delivering');
      const branch = `praxis/${runId.slice(0, 8)}`;
      const prefix = repoCtx.greenfield ? 'feat' : 'feat';
      const commitTitle = `${prefix}: ${wi.title}`.slice(0, 72);
      const commitMsg = `${commitTitle}\n\n${plan.summary}\n\nWork item: ${wi.title}\nRun: ${runId}`;

      await tool('git.branch', { name: branch });
      await emit('git.branch.created', { runId, repo: vcs ? String(vcs.connector.config.projectPath) : 'local', branch, baseSha: 'main' });
      await tool('git.add', {});
      await tool('git.commit', { message: commitMsg });
      const log = await tool('git.log', {});
      const headSha = (log.outputPreview.trim().split(/\s/)[0] || 'unknown').slice(0, 12);
      await emit('git.commit.created', { runId, sha: headSha, message: commitTitle, filesChanged: changed.size });

      let prRef: { number: number; url: string; state: string } | null = null;
      const prBody = [
        plan.summary,
        '',
        `### Files (${changed.size})`,
        [...changed].map((f) => `- \`${f}\``).join('\n'),
        '',
        `### Verification`,
        verifyOk ? '✅ ' + verifySummary : '⚠️ ' + verifySummary,
        '',
        `### Review — ${review.verdict}`,
        review.summary || '(no summary)',
        ...(review.findings.length ? ['', ...review.findings.map((f) => `- **${f.severity}**: ${f.message}`)] : []),
        '',
        '---',
        `_Opened by a Praxis run (\`${runId}\`) for merge by a human._`,
      ].join('\n');

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
              title: commitTitle,
              body: prBody,
              idempotencyKey: `${runId}:${branch}`,
              labels: verifyOk ? ['praxis'] : ['praxis', 'needs-attention'],
            },
          );
          prRef = { number: mr.number, url: mr.url, state: mr.state };
          await emit('vcs.pr.opened', { runId, repo: String(vcs.connector.config.projectPath), prNumber: mr.number, url: mr.url, state: mr.state });

          if (tracker && workItem.sourceConnectorId && workItem.sourceConnectorId !== 'manual' && tracker.provider.linkPullRequest) {
            await tracker.provider
              .linkPullRequest(workItem.externalId, mr.url)
              .then(() => emit('progress.warning', { runId, kind: 'tracker_linked', evidence: `issue #${workItem.externalId}` }))
              .catch((e) => this.log.warn(`tracker write-back: ${(e as Error).message}`));
          }
        } catch (e) {
          await emit('progress.warning', { runId, kind: 'mr_create_failed', evidence: (e as Error).message });
        }
      } else {
        await emit('vcs.pr.updated', {
          runId, repo: 'local', prNumber: 0, url: '', state: 'no_connector',
          note: 'branch + commit produced; bind a VCS connector to push + open a PR/MR',
          diffPreview: diff.slice(0, 6000),
        });
      }

      await this.runs.update({ id: runId }, { branchName: branch, headSha, prRef });

      // ── done ───────────────────────────────────────────────────────────
      const run = await this.runs.findOneByOrFail({ id: runId });
      run.state = 'succeeded';
      run.endedAt = new Date();
      await this.runs.save(run);
      await this.events.append({
        tenantId, runId, type: 'run.state_changed',
        payload: { runId, from: 'delivering', to: 'succeeded' },
        actor: { kind: 'system', id: 'inproc-driver' },
      });
      await emit('run.completed', { runId, outcome: 'succeeded', prUrl: prRef?.url, filesChanged: changed.size });
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
        tenantId, runId, type: 'run.state_changed', payload: { runId, to: 'failed' },
      });
      await this.events.append({
        tenantId, runId, type: 'run.failed', payload: { runId, category, message },
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
        tenantId, runId, type: 'run.state_changed', payload: { runId, to: 'cancelled' },
      });
    }
  }

  private async gate(control: Control, runId: string) {
    if (control.cancelled) throw new Error('cancelled');
    while (control.paused) {
      await new Promise((r) => setTimeout(r, 250));
      if (control.cancelled) throw new Error('cancelled');
    }
  }
}

const shq = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const tail = (s: string, n = 800) => {
  const t = (s ?? '').trim();
  return t.length > n ? '…' + t.slice(-n) : t;
};
