/** Shared primitives used across every contract. */

export type Uuid = string;
export type IsoDateTime = string; // ISO-8601 UTC

/** Health of a provider/connector instance. */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'down';
  checkedAt: IsoDateTime;
  detail?: string;
  latencyMs?: number;
}

/** Every risky capability is classified into one of these tiers. */
export type RiskTier = 'auto' | 'notify' | 'approve' | 'forbidden';

/** Where a tool runs. */
export type ExecutionLocation = 'sandbox' | 'control-plane';

/** Attribution attached to any metered operation (model call, tool call). */
export interface Attribution {
  tenantId: Uuid;
  projectId: Uuid;
  runId?: Uuid;
  stepId?: Uuid;
  agentRole?: AgentRole;
}

export type AgentRole = 'triager' | 'planner' | 'coder' | 'reviewer' | 'researcher';

/** Reference to a secret held by the SecretsProvider — never the value. */
export interface SecretRef {
  id: string;
  version?: string;
}

/** A paginated result (cursor-based). */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

/** Contract kinds a Connector can implement. */
export type ContractKind = 'tracker' | 'vcs' | 'chatops' | 'ci' | 'kv' | 'mcp';

/** JSON Schema (draft 2020-12) as a plain object. */
export type JsonSchema = Record<string, unknown>;
