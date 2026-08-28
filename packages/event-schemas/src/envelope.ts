/** prd/11 §2. Every event on the bus and in `run_event` has this envelope. */
export interface EventEnvelope {
  /** stable event id (uuid v7) — consumers dedupe on this */
  id: string;
  /** dot-namespaced type from the catalog, e.g. 'tool_call.finished' */
  type: string;
  /** payload schema version for this type */
  schemaVersion: number;
  tenantId: string;
  /** present for run-scoped events */
  runId?: string;
  stepId?: string;
  /** OpenTelemetry trace id linking logs ↔ traces ↔ Langfuse ↔ run_event */
  traceId?: string;
  /** monotonic, gap-free per run (assigned by the orchestrator) */
  seq?: number;
  ts: string; // ISO-8601 UTC
  /** who/what caused it, when applicable */
  actor?: { kind: 'user' | 'service' | 'agent' | 'system'; id: string; display?: string };
}

export type PlatformEvent<P = Record<string, unknown>> = EventEnvelope & { payload: P };

export const CURRENT_SCHEMA_VERSION = 1;
