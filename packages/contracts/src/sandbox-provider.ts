import { HealthStatus, Uuid } from './common';

export type SandboxBackend = 'firecracker-pool' | 'gvisor' | 'docker' | 'e2b';

export interface EgressPolicy {
  /** default-deny; only these hosts are reachable */
  allowHosts: string[];
  allowPorts?: number[];
  maxBandwidthKbps?: number;
}

export interface SandboxSpec {
  runId: Uuid;
  image: string; // rootfs / container image ref
  cpuMillis: number;
  memoryMb: number;
  diskMb: number;
  egress: EgressPolicy;
  /** files mounted for the run's lifetime, wiped on teardown (e.g. git credential). */
  secretFiles?: { path: string; contentB64: string; mode?: number }[];
  env?: Record<string, string>;
  ttlSeconds: number;
}

export interface SandboxHandle {
  id: string;
  backend: SandboxBackend;
  createdAt: string;
}

export interface ExecRequest {
  cmd: string[];
  cwd?: string;
  timeoutMs: number;
  stdin?: string;
}

export interface ExecChunk {
  stream: 'stdout' | 'stderr';
  data: string;
}

export interface ExecResult {
  exitCode: number;
  durationMs: number;
  truncated: boolean;
  /** combined stdout+stderr, bounded (see `truncated`) */
  output: string;
  /** object-storage key of the full captured output, when truncated */
  fullOutputRef?: string;
}

export interface SnapshotRef {
  id: string;
  sizeBytes?: number;
}

/** ADR-0005. */
export interface SandboxProvider {
  readonly backend: SandboxBackend;

  acquire(spec: SandboxSpec): Promise<SandboxHandle>;
  exec(handle: SandboxHandle, req: ExecRequest): AsyncIterable<ExecChunk>;
  execCollect(handle: SandboxHandle, req: ExecRequest): Promise<ExecResult>;

  writeFile(handle: SandboxHandle, path: string, contentB64: string): Promise<void>;
  readFile(handle: SandboxHandle, path: string, maxBytes?: number): Promise<string>;

  snapshot(handle: SandboxHandle): Promise<SnapshotRef>;
  restore(snapshot: SnapshotRef): Promise<SandboxHandle>;

  release(handle: SandboxHandle): Promise<void>;

  poolStats(): Promise<{ total: number; warm: number; leased: number; failed: number }>;
  healthCheck(): Promise<HealthStatus>;
}
