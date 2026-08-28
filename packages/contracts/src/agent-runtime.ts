import { AgentRole, Uuid } from './common';

/** prd/13 §4 — the control-plane ↔ Python agent-worker RPC surface (proto-defined in practice). */

export interface RepoLocator {
  sandboxId: string;
  repoPath: string;
  baseBranch: string;
  baseSha: string;
}

export interface TriageRequest {
  runId: Uuid;
  workItem: { title: string; bodyMd: string; acceptanceCriteria: string[]; labels: string[] };
}

export interface TriageResult {
  type: 'feature' | 'bug' | 'chore' | 'refactor' | 'test' | 'docs';
  size: 'S' | 'M' | 'L' | 'XL';
  verdict: 'ready' | 'needs_info' | 'not_suitable';
  reasoning: string;
  questions?: string[];
}

export interface RepoMapResult {
  tokens: number;
  fileCount: number;
  symbolCount: number;
  embeddedChunks: number;
}

export interface PlanStepDraft {
  index: number;
  title: string;
  rationale: string;
  files: string[];
  kind: string;
  riskTier: 'auto' | 'notify' | 'approve';
}

export interface PlanResult {
  version: number;
  summaryMd: string;
  steps: PlanStepDraft[];
  testStrategyMd: string;
  riskMd: string;
  filesEstimate: string[];
}

export interface StepRequest {
  runId: Uuid;
  stepId: Uuid;
  planStep: PlanStepDraft;
  repo: RepoLocator;
  /** operator guidance injected since last turn */
  operatorMessages?: string[];
  /** decision delivered for a prior approval interrupt */
  resumedApproval?: { approved: boolean; note?: string; grant?: Record<string, number> };
}

export type StepOutcome =
  | { kind: 'completed'; filesTouched: string[]; iterations: number }
  | { kind: 'needs_approval'; approval: { type: string; evidence: unknown; actionPreview: unknown } }
  | { kind: 'failed'; category: string; message: string };

export interface ReviewRequest {
  runId: Uuid;
  repo: RepoLocator;
  diffRef: string;
  acceptanceCriteria: string[];
}

export interface ReviewResult {
  verdict: 'pass' | 'concerns' | 'block';
  findings: { severity: 'info' | 'low' | 'medium' | 'high'; message: string; file?: string; line?: number }[];
}

/** Streamed while a role runs — re-published verbatim onto the platform EventBus. */
export interface AgentEvent {
  runId: Uuid;
  stepId?: Uuid;
  role: AgentRole;
  type: string; // matches the platform event catalog (prd/11 §4)
  payload: Record<string, unknown>;
  ts: string;
}

export interface AgentRuntime {
  runTriage(req: TriageRequest): Promise<TriageResult>;
  buildRepoMap(repo: RepoLocator): Promise<RepoMapResult>;
  runPlan(req: { runId: Uuid; repo: RepoLocator; workItem: TriageRequest['workItem'] }): AsyncIterable<AgentEvent | { done: PlanResult }>;
  executeStep(req: StepRequest): AsyncIterable<AgentEvent | { done: StepOutcome }>;
  runReview(req: ReviewRequest): Promise<ReviewResult>;
}
