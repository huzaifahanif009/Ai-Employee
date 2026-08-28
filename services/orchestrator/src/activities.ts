/**
 * Temporal activities — the only place side effects happen (ADR-0002).
 * Phase 1: they call the core internal API / agent HTTP with stub payloads.
 * Phase 2/3: real repo-prep (Sandbox Broker), real agent gRPC, real verification.
 */
import { request } from 'undici';
import type { ActivityResult, RunWorkflowInput, StepSpec } from './shared';

const CORE_URL = process.env.CORE_INTERNAL_URL ?? 'http://localhost:3000';
const AGENT_URL = process.env.AGENT_RUNTIME_URL ?? 'http://localhost:8081';
const SVC_TOKEN = process.env.ORCHESTRATOR_SERVICE_TOKEN ?? '';

async function coreEvent(
  input: RunWorkflowInput,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // Phase 2: a dedicated internal endpoint. For now this is a no-op placeholder
  // unless CORE_INTERNAL_EVENTS=1 and the endpoint exists.
  if (process.env.CORE_INTERNAL_EVENTS !== '1') return;
  await request(`${CORE_URL}/internal/runs/${input.runId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SVC_TOKEN}` },
    body: JSON.stringify({ type, payload }),
  }).catch(() => undefined);
}

export async function triage(input: RunWorkflowInput): Promise<ActivityResult> {
  await coreEvent(input, 'work_item.triaged', { runId: input.runId });
  const res = await request(`${AGENT_URL}/v1/triage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      runId: input.runId,
      workItem: { title: 'from-core', bodyMd: '', acceptanceCriteria: [] },
    }),
  });
  const data = await res.body.json();
  return { ok: true, data };
}

export async function prepRepo(input: RunWorkflowInput): Promise<ActivityResult> {
  await coreEvent(input, 'run.state_changed', { runId: input.runId, to: 'planning' });
  return { ok: true, data: { sandboxId: `stub-${input.runId}`, baseSha: 'stub' } };
}

export async function plan(input: RunWorkflowInput): Promise<ActivityResult<{ steps: StepSpec[] }>> {
  const res = await request(`${AGENT_URL}/v1/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      runId: input.runId,
      repo: { sandboxId: `stub-${input.runId}`, repoPath: '/w', baseBranch: 'main', baseSha: 'stub' },
      workItem: { title: 'from-core', bodyMd: '', acceptanceCriteria: [] },
    }),
  });
  const p = (await res.body.json()) as {
    steps: { index: number; title: string; files: string[]; riskTier: StepSpec['riskTier'] }[];
  };
  return {
    ok: true,
    data: {
      steps: p.steps.map((s) => ({
        stepId: `${input.runId}-s${s.index}`,
        index: s.index,
        title: s.title,
        files: s.files,
        riskTier: s.riskTier,
      })),
    },
  };
}

export async function executeStep(
  input: RunWorkflowInput,
  step: StepSpec,
): Promise<ActivityResult> {
  const res = await request(`${AGENT_URL}/v1/execute-step`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      runId: input.runId,
      stepId: step.stepId,
      planStep: { index: step.index, title: step.title, rationale: '', files: step.files, kind: 'edit', riskTier: step.riskTier },
      repo: { sandboxId: `stub-${input.runId}`, repoPath: '/w', baseBranch: 'main', baseSha: 'stub' },
    }),
  });
  return { ok: true, data: await res.body.json() };
}

export async function verify(input: RunWorkflowInput): Promise<ActivityResult> {
  await coreEvent(input, 'verify.finished', { runId: input.runId, overall: 'pass' });
  return { ok: true, data: { overall: 'pass' } };
}

export async function review(input: RunWorkflowInput): Promise<ActivityResult> {
  const res = await request(`${AGENT_URL}/v1/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      runId: input.runId,
      repo: { sandboxId: `stub-${input.runId}`, repoPath: '/w', baseBranch: 'main', baseSha: 'stub' },
      diffRef: 'stub',
      acceptanceCriteria: [],
    }),
  });
  return { ok: true, data: await res.body.json() };
}

export async function deliver(input: RunWorkflowInput): Promise<ActivityResult> {
  await coreEvent(input, 'vcs.pr.opened', { runId: input.runId, prNumber: 1, url: 'http://local/pr/1' });
  return { ok: true, data: { prUrl: 'http://local/pr/1' } };
}

export async function markRunState(
  input: RunWorkflowInput,
  to: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await coreEvent(input, 'run.state_changed', { runId: input.runId, to, ...extra });
}
