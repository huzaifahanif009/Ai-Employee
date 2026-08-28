import { ExecutionLocation, JsonSchema, RiskTier, Uuid } from './common';

/** prd/09 §4. Native + connector-provided + MCP tools all share this shape. */
export interface ToolDefinition {
  name: string; // 'fs.read', 'shell.exec', 'vcs.open_pr', 'mcp:<server>/<tool>'
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  execution: ExecutionLocation;
  riskTier: RiskTier; // platform default; Policy may raise, never lower below the minimum
  idempotent: boolean;
  scopes: string[];
  rateLimit?: { perRun?: number; perMinute?: number };
  timeoutMs: number;
  redactOutput?: boolean;
  untrustedOutput?: boolean;
}

export interface ToolCallContext {
  tenantId: Uuid;
  projectId: Uuid;
  runId: Uuid;
  stepId: Uuid;
  agentRole: string;
  sandboxId?: string;
  /** resolved from Policy at dispatch time */
  effectiveRiskTier: RiskTier;
}

export type ToolCallStatus = 'ok' | 'error' | 'denied' | 'needs_approval';

export interface ToolCallResult {
  status: ToolCallStatus;
  outputPreview: string;
  outputArtifactId?: string;
  durationMs: number;
  bytesOut: number;
  error?: string;
}

/** The Tool Broker: validate → resolve risk → check policy/scopes → rate-limit → dispatch → record. */
export interface ToolBroker {
  list(projectId: Uuid): Promise<ToolDefinition[]>;
  call(
    ctx: ToolCallContext,
    tool: string,
    input: Record<string, unknown>,
  ): Promise<ToolCallResult>;
}
