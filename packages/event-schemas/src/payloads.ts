/** Typed payloads for the most-used events. Extend as the platform grows. */
import type { RunState, RunFailureCategory } from './catalog';

export interface RunCreatedPayload {
  runId: string;
  workItemId: string;
  projectId: string;
  agentConfigVersionId: string;
  policyVersionId: string;
}

export interface RunStateChangedPayload {
  runId: string;
  from: RunState;
  to: RunState;
}

export interface RunTotalsPayload {
  runId: string;
  tokens: number;
  costUsd: number;
  toolCalls: number;
  filesChanged: number;
  wallMs: number;
}

export interface RunFailedPayload {
  runId: string;
  category: RunFailureCategory;
  message: string;
  lastGoodStepId?: string;
}

export interface PlanCreatedPayload {
  runId: string;
  planId: string;
  version: number;
  stepCount: number;
  filesEstimate: string[];
  risk: string;
}

export interface RunStepStartedPayload {
  runId: string;
  stepId: string;
  index: number;
  role: string;
  title: string;
}

export interface ToolCallStartedPayload {
  runId: string;
  stepId: string;
  toolCallId: string;
  tool: string;
  argsPreview: string;
  riskTier: string;
}

export interface ToolCallFinishedPayload {
  runId: string;
  stepId: string;
  toolCallId: string;
  status: 'ok' | 'error' | 'denied' | 'needs_approval';
  durationMs: number;
  bytesOut: number;
  outputPreview: string;
  artifactId?: string;
}

export interface MessageDeltaPayload {
  runId: string;
  stepId: string;
  role: string;
  deltaText: string;
}

export interface ApprovalRequestedPayload {
  approvalId: string;
  runId: string;
  type: 'plan' | 'risky_action' | 'budget' | 'review_block' | 'policy_exception' | 'non_progress';
  evidence: Record<string, unknown>;
  actionPreview: Record<string, unknown>;
  slaAt: string;
}

export interface ApprovalDecidedPayload {
  approvalId: string;
  runId: string;
  decision: 'approve' | 'reject' | 'request_replan' | 'grant_budget' | 'deliver_anyway';
  decidedBy: string;
  note?: string;
}

export interface FleetCountersPayload {
  runsByState: Record<RunState, number>;
  activeAgents: number;
  openApprovals: number;
  queueDepth: number;
}

export interface VcsPrOpenedPayload {
  runId: string;
  repo: string;
  prNumber: number;
  url: string;
  state: 'open' | 'closed' | 'merged';
}
