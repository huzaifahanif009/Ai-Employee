import type { RunState, WorkItemState } from "@praxis/event-schemas";

export type Role = "owner" | "admin" | "maintainer" | "operator" | "viewer" | "service";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface Identity {
  userId: string;
  tenantId: string;
  role: Role;
  email: string;
  name: string;
}

export interface Project {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  repoRef: { provider: string; owner: string; name: string; path?: string } | null;
  vcsConnectorId: string | null;
  trackerConnectorId: string | null;
  baseBranch: string;
  verifyPipeline: Record<string, string>;
  intake: { mode: "auto" | "manual"; labelAllowlist: string[] };
  policyPreset: "Conservative" | "Balanced" | "Autonomous";
  budgets: Record<string, number>;
  createdAt: string;
}

export interface WorkItem {
  id: string;
  tenantId: string;
  projectId: string;
  sourceConnectorId: string;
  externalId: string;
  externalUrl: string | null;
  title: string;
  bodyMd: string;
  acceptanceCriteria: string[];
  labels: string[];
  priority: "low" | "normal" | "high" | "urgent";
  state: WorkItemState;
  triage: {
    type?: string;
    size?: string;
    verdict?: string;
    reasoning?: string;
    questions?: string[];
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunTotals {
  tokens: number;
  costUsd: number;
  toolCalls: number;
  filesChanged: number;
  wallMs: number;
}

export interface Run {
  id: string;
  tenantId: string;
  projectId: string;
  workItemId: string;
  seq: number;
  state: RunState;
  failureCategory: string | null;
  failureMessage: string | null;
  branchName: string | null;
  headSha: string | null;
  prRef: { number: number; url: string; state: string } | null;
  totals: RunTotals;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export type ApprovalType =
  | "plan"
  | "risky_action"
  | "budget"
  | "review_block"
  | "policy_exception"
  | "non_progress"
  | "delivery";

export type ApprovalState = "open" | "approved" | "rejected" | "expired" | "auto_resolved";

export interface Approval {
  id: string;
  tenantId: string;
  runId: string;
  runStepId: string | null;
  type: ApprovalType;
  state: ApprovalState;
  evidence: Record<string, unknown>;
  actionPreview: Record<string, unknown>;
  slaAt: string;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  channel: "dashboard" | "slack" | "api";
}

export type ApprovalDecision =
  | "approve"
  | "reject"
  | "request_replan"
  | "grant_budget"
  | "deliver_anyway";

export interface ModelCall {
  id: string;
  runId: string | null;
  runStepId: string | null;
  agentRole: string | null;
  purpose: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: string;
  latencyMs: number;
  cacheHit: "none" | "exact" | "semantic";
  finishReason: string | null;
  redactedSpans: number;
  createdAt: string;
}

export interface Connector {
  id: string;
  kind: "gitlab" | "github" | "bitbucket" | "generic-git";
  name: string;
  contracts: string[];
  config: { baseUrl?: string; projectPath?: string | null };
  authKind: string;
  secretHint: string | null;
  webhookSecretHint: string | null;
  status: "healthy" | "degraded" | "down" | "unconfigured";
  healthDetail: string | null;
  lastHealthAt: string | null;
  createdAt: string;
  usedByProjects: { id: string; name: string }[];
}

export interface RepoRef {
  id: string;
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
  visibility: string;
}

export interface ToolCall {
  id: string;
  runId: string;
  runStepId: string | null;
  seq: number;
  toolName: string;
  execution: "sandbox" | "control-plane";
  riskTier: "auto" | "notify" | "approve" | "forbidden";
  input: Record<string, unknown>;
  outputPreview: string;
  status: "ok" | "error" | "denied" | "needs_approval";
  durationMs: number;
  bytesOut: number;
  error: string | null;
  createdAt: string;
}

export type AiProviderKind =
  | "openai"
  | "anthropic"
  | "google"
  | "openai-compatible"
  | "azure-openai";

export interface AiProviderKey {
  id: string;
  providerId: string;
  label: string;
  last4: string;
  enabled: boolean;
  isDefault: boolean;
  status: "untested" | "valid" | "invalid" | "error";
  lastTestDetail: string | null;
  lastTestedAt: string | null;
  createdAt: string;
}

export interface AiModel {
  id: string;
  providerId: string;
  alias: string;
  providerModel: string;
  routingClasses: string[];
  capabilities: string[];
  contextWindow: number;
  maxOutput: number;
  priceInputPerMTok: string;
  priceOutputPerMTok: string;
  enabled: boolean;
  isDefault: boolean;
}

export interface AiProvider {
  id: string;
  kind: AiProviderKind;
  name: string;
  baseUrl: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  keys: AiProviderKey[];
  models: AiModel[];
}

export interface ModelCatalogEntry {
  alias: string;
  provider: string;
  model: string;
  contextWindow: number;
  maxOutput: number;
  capabilities: string[];
  priceInputPerMTok: number;
  priceOutputPerMTok: number;
  latencyClass: string;
  dataRegion: string;
  enabled: boolean;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  meta?: Record<string, unknown>;
}
