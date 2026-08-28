/** prd/11 §4 — the event catalog. Keep in sync with the JSON schemas in ../schemas. */

export const EVENT_TYPES = [
  // work item / intake
  'work_item.received',
  'work_item.updated',
  'work_item.triaged',
  'work_item.needs_info',
  'work_item.rejected',
  // run lifecycle
  'run.created',
  'run.state_changed',
  'run.totals_updated',
  'run.failed',
  'run.completed',
  'run.paused',
  'run.resumed',
  // plan
  'plan.created',
  'plan.step_defined',
  'plan.revised',
  // step / agent activity (AG-UI shaped)
  'run_step.started',
  'run_step.finished',
  'message.delta',
  'message.done',
  'tool_call.started',
  'tool_call.args_delta',
  'tool_call.finished',
  'context.compacted',
  'progress.warning',
  // model calls
  'model_call.started',
  'model_call.routed',
  'model_call.finished',
  'model_call.fallback',
  'provider.health_changed',
  // verification & review
  'verify.started',
  'verify.check_started',
  'verify.check_log',
  'verify.check_finished',
  'verify.finished',
  'review.started',
  'review.finished',
  // approvals & HITL
  'approval.requested',
  'approval.decided',
  'approval.expired',
  'operator.message',
  // delivery & git
  'git.branch.created',
  'git.commit.created',
  'git.pushed',
  'vcs.pr.opened',
  'vcs.pr.updated',
  'git.pr.merged',
  'git.checks.updated',
  // fleet / system
  'fleet.counters',
  'system.health',
  'budget.threshold',
  'connector.health_changed',
  'audit.appended',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const isEventType = (t: string): t is EventType =>
  (EVENT_TYPES as readonly string[]).includes(t);

/** Run state machine (prd/00 glossary). */
export const RUN_STATES = [
  'queued',
  'planning',
  'awaiting_plan_approval',
  'executing',
  'verifying',
  'reviewing',
  'awaiting_delivery_approval',
  'delivering',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
] as const;
export type RunState = (typeof RUN_STATES)[number];

export const TERMINAL_RUN_STATES: RunState[] = ['succeeded', 'failed', 'cancelled', 'timed_out'];

/** Allowed transitions — enforced by the Runs service and the orchestrator. */
export const RUN_TRANSITIONS: Record<RunState, RunState[]> = {
  queued: ['planning', 'cancelled', 'failed'],
  planning: ['awaiting_plan_approval', 'executing', 'failed', 'cancelled'],
  awaiting_plan_approval: ['executing', 'failed', 'cancelled', 'timed_out'],
  executing: ['verifying', 'awaiting_plan_approval', 'failed', 'cancelled', 'timed_out'],
  verifying: ['reviewing', 'executing', 'failed', 'cancelled', 'timed_out'],
  reviewing: ['awaiting_delivery_approval', 'delivering', 'executing', 'failed', 'cancelled'],
  awaiting_delivery_approval: ['delivering', 'failed', 'cancelled', 'timed_out'],
  delivering: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
  timed_out: [],
};

export const canTransition = (from: RunState, to: RunState): boolean =>
  RUN_TRANSITIONS[from]?.includes(to) ?? false;

export const WORK_ITEM_STATES = [
  'received',
  'triaging',
  'ready',
  'needs_info',
  'rejected',
  'in_progress',
  'delivered',
  'failed',
  'closed',
] as const;
export type WorkItemState = (typeof WORK_ITEM_STATES)[number];

export type RunFailureCategory =
  | 'needs_info'
  | 'plan_rejected'
  | 'tests_never_passed'
  | 'non_progress'
  | 'budget_exceeded'
  | 'policy_block'
  | 'provider_unavailable'
  | 'sandbox_error'
  | 'vcs_error'
  | 'timed_out'
  | 'cancelled';
