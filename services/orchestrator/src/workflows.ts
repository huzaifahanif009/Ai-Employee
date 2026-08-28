/**
 * RunWorkflow — one Temporal workflow per Run (ADR-0002, prd/05 §4).
 * Deterministic control flow: an LLM never decides which step runs next.
 * Side effects live only in activities. HITL gates = wait for a signal.
 */
import * as wf from '@temporalio/workflow';
import type * as acts from './activities';
import type { ApprovalDecision, RunWorkflowInput, StepSpec } from './shared';
import { RUN_SIGNALS } from './shared';

const {
  triage,
  prepRepo,
  plan,
  executeStep,
  verify,
  review,
  deliver,
  markRunState,
} = wf.proxyActivities<typeof acts>({
  startToCloseTimeout: '10 minutes',
  retry: { maximumAttempts: 3 },
});

export const approvalGrantedSignal = wf.defineSignal<[ApprovalDecision]>(RUN_SIGNALS.approvalGranted);
export const approvalRejectedSignal = wf.defineSignal<[ApprovalDecision]>(RUN_SIGNALS.approvalRejected);
export const cancelSignal = wf.defineSignal<[]>(RUN_SIGNALS.cancel);
export const pauseSignal = wf.defineSignal<[]>(RUN_SIGNALS.pause);
export const resumeSignal = wf.defineSignal<[]>(RUN_SIGNALS.resume);
export const operatorMessageSignal = wf.defineSignal<[string]>(RUN_SIGNALS.operatorMessage);

export const runStateQuery = wf.defineQuery<string>('runState');

export async function RunWorkflow(input: RunWorkflowInput): Promise<{ outcome: string; prUrl?: string }> {
  let state = 'queued';
  let cancelled = false;
  let paused = false;
  let pendingApproval: ApprovalDecision | undefined;
  const operatorMessages: string[] = [];

  wf.setHandler(runStateQuery, () => state);
  wf.setHandler(cancelSignal, () => {
    cancelled = true;
  });
  wf.setHandler(pauseSignal, () => {
    paused = true;
  });
  wf.setHandler(resumeSignal, () => {
    paused = false;
  });
  wf.setHandler(operatorMessageSignal, (m) => {
    operatorMessages.push(m);
  });
  wf.setHandler(approvalGrantedSignal, (d) => {
    pendingApproval = d;
  });
  wf.setHandler(approvalRejectedSignal, (d) => {
    pendingApproval = d;
  });

  const guard = async () => {
    if (cancelled) throw wf.ApplicationFailure.nonRetryable('cancelled', 'cancelled');
    if (paused) await wf.condition(() => !paused || cancelled);
    if (cancelled) throw wf.ApplicationFailure.nonRetryable('cancelled', 'cancelled');
  };

  const set = async (s: string, extra: Record<string, unknown> = {}) => {
    state = s;
    await markRunState(input, s, extra);
  };

  const waitForApproval = async (): Promise<ApprovalDecision> => {
    pendingApproval = undefined;
    await wf.condition(() => pendingApproval !== undefined || cancelled, '2 days');
    if (cancelled) throw wf.ApplicationFailure.nonRetryable('cancelled', 'cancelled');
    if (!pendingApproval) throw wf.ApplicationFailure.nonRetryable('approval SLA expired', 'timed_out');
    return pendingApproval;
  };

  try {
    await guard();
    await set('planning');
    await triage(input);
    await prepRepo(input);
    const planned = await plan(input);
    const steps: StepSpec[] = planned.data?.steps ?? [];

    // Plan approval gate (Beta default ON; Phase 2 makes it Policy-driven).
    if (process.env.REQUIRE_PLAN_APPROVAL === '1') {
      await set('awaiting_plan_approval');
      const d = await waitForApproval();
      if (d.decision === 'reject') {
        await set('failed', { failureCategory: 'plan_rejected' });
        return { outcome: 'failed' };
      }
    }

    await set('executing');
    for (const step of steps) {
      await guard();
      if (step.riskTier === 'approve') {
        await set('awaiting_plan_approval', { stepId: step.stepId });
        const d = await waitForApproval();
        if (d.decision === 'reject') {
          await set('failed', { failureCategory: 'policy_block' });
          return { outcome: 'failed' };
        }
        await set('executing');
      }
      await executeStep(input, step);
    }

    await guard();
    await set('verifying');
    await verify(input);

    await set('reviewing');
    await review(input);

    if (process.env.REQUIRE_DELIVERY_APPROVAL === '1') {
      await set('awaiting_delivery_approval');
      const d = await waitForApproval();
      if (d.decision === 'reject') {
        await set('failed', { failureCategory: 'plan_rejected' });
        return { outcome: 'failed' };
      }
    }

    await set('delivering');
    const del = await deliver(input);

    await set('succeeded');
    return { outcome: 'succeeded', prUrl: (del.data as { prUrl?: string })?.prUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const category = /cancelled/.test(msg) ? 'cancelled' : /SLA|timed_out/.test(msg) ? 'timed_out' : 'sandbox_error';
    await set(category === 'cancelled' ? 'cancelled' : category === 'timed_out' ? 'timed_out' : 'failed', {
      failureCategory: category,
      message: msg,
    });
    return { outcome: category };
  }
}
