/** Types shared between the workflow and its activities. Keep serialisable. */
import type { RunState } from '@praxis/event-schemas';

export interface RunWorkflowInput {
  runId: string;
  tenantId: string;
  projectId: string;
  workItemId: string;
}

export interface ApprovalDecision {
  approvalId: string;
  decision: 'approve' | 'reject' | 'request_replan' | 'grant_budget' | 'deliver_anyway';
  note?: string;
  grant?: Record<string, number>;
}

export interface StepSpec {
  stepId: string;
  index: number;
  title: string;
  files: string[];
  riskTier: 'auto' | 'notify' | 'approve';
}

export interface ActivityResult<T = unknown> {
  ok: boolean;
  data?: T;
  failureCategory?: string;
  message?: string;
}

export const RUN_SIGNALS = {
  approvalGranted: 'approvalGranted',
  approvalRejected: 'approvalRejected',
  cancel: 'cancel',
  pause: 'pause',
  resume: 'resume',
  operatorMessage: 'operatorMessage',
} as const;

export type OrchestratorRunState = RunState;
