import { randomBytes } from "node:crypto";
import { Logger } from "@nestjs/common";
import { PraxisError } from "@praxis/contracts";
import type {
  ExecChunk,
  ExecRequest,
  ExecResult,
  HealthStatus,
  SandboxHandle,
  SandboxProvider,
  SandboxSpec,
  SnapshotRef,
} from "@praxis/contracts";
import { run, runStream } from "./exec";

const SANDBOX_DOCKERFILE = `FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \\
      git ca-certificates ripgrep python3 curl \\
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /workspace && git config --system user.email praxis@local && git config --system user.name Praxis
WORKDIR /workspace
CMD ["sleep", "infinity"]
`;

/**
 * ADR-0005 — the `docker` SandboxProvider backend. Local/demo only; **not an isolation
 * boundary** (shared kernel, socket access). Firecracker/gVisor backends implement the
 * same interface for real multi-tenant isolation.
 *
 * Shells out to the `docker` CLI against a mounted socket — more robust cross-platform
 * (Docker Desktop on Windows included) than a socket library.
 */
export class DockerSandboxProvider implements SandboxProvider {
  readonly backend = "docker" as const;
  private readonly log = new Logger("DockerSandbox");
  private imageReady = false;

  constructor(
    private readonly image: string,
    private readonly network: string,
    private readonly workdir: string,
  ) {}

  private async ensureImage(): Promise<void> {
    if (this.imageReady) return;
    const inspect = await run(["docker", "image", "inspect", this.image], { timeoutMs: 10_000 });
    if (inspect.code === 0) {
      this.imageReady = true;
      return;
    }
    this.log.log(`building sandbox image ${this.image} (first use)…`);
    const build = await run(["docker", "build", "-t", this.image, "-"], {
      input: SANDBOX_DOCKERFILE,
      timeoutMs: 300_000,
    });
    if (build.code !== 0) {
      throw new PraxisError("SANDBOX_ERROR", `sandbox image build failed: ${build.stderr.slice(-500)}`, 500);
    }
    this.imageReady = true;
  }

  async acquire(spec: SandboxSpec): Promise<SandboxHandle> {
    await this.ensureImage();
    const name = `praxis-sbx-${spec.runId.slice(0, 8)}-${randomBytes(3).toString("hex")}`;
    const args = [
      "docker", "run", "-d",
      "--name", name,
      "--label", "praxis.sandbox=1",
      "--label", `praxis.run=${spec.runId}`,
      "--network", this.network,
      "--memory", `${Math.max(256, spec.memoryMb)}m`,
      "--cpus", String(Math.max(0.25, spec.cpuMillis / 1000)),
      "--pids-limit", "512",
      "-w", this.workdir,
    ];
    for (const [k, v] of Object.entries(spec.env ?? {})) args.push("-e", `${k}=${v}`);
    args.push(this.image);

    const res = await run(args, { timeoutMs: 30_000 });
    if (res.code !== 0) {
      throw new PraxisError("SANDBOX_ERROR", `docker run failed: ${res.stderr.slice(-500)}`, 500);
    }
    const id = res.stdout.trim();

    for (const f of spec.secretFiles ?? []) {
      await this.writeFileRaw(id, f.path, f.contentB64);
    }

    return { id, backend: "docker", createdAt: new Date().toISOString() };
  }

  async *exec(handle: SandboxHandle, req: ExecRequest): AsyncIterable<ExecChunk> {
    const cwd = req.cwd ?? this.workdir;
    yield* runStream(["docker", "exec", "-w", cwd, handle.id, ...req.cmd], {
      timeoutMs: req.timeoutMs,
    });
  }

  async execCollect(handle: SandboxHandle, req: ExecRequest): Promise<ExecResult> {
    const cwd = req.cwd ?? this.workdir;
    const args = ["docker", "exec", "-w", cwd];
    if (req.stdin !== undefined) args.push("-i");
    args.push(handle.id, ...req.cmd);
    const res = await run(args, { input: req.stdin, timeoutMs: req.timeoutMs });
    const combined = (res.stdout + (res.stderr ? `\n${res.stderr}` : "")).trimEnd();
    return {
      exitCode: res.timedOut ? 124 : res.code,
      durationMs: res.durationMs,
      truncated: combined.length >= 512 * 1024,
      output: combined,
    };
  }

  private async writeFileRaw(containerId: string, path: string, contentB64: string): Promise<void> {
    const res = await run(
      ["docker", "exec", "-i", containerId, "sh", "-c", 'mkdir -p "$(dirname "$0")" && base64 -d > "$0"', path],
      { input: contentB64, timeoutMs: 15_000 },
    );
    if (res.code !== 0) {
      throw new PraxisError("SANDBOX_ERROR", `writeFile ${path} failed: ${res.stderr.slice(-300)}`, 500);
    }
  }

  writeFile(handle: SandboxHandle, path: string, contentB64: string): Promise<void> {
    return this.writeFileRaw(handle.id, path, contentB64);
  }

  async readFile(handle: SandboxHandle, path: string, maxBytes = 200_000): Promise<string> {
    const res = await run(
      ["docker", "exec", handle.id, "sh", "-c", `head -c ${maxBytes} "$0"`, path],
      { timeoutMs: 15_000 },
    );
    if (res.code !== 0) {
      throw new PraxisError("SANDBOX_ERROR", `readFile ${path} failed: ${res.stderr.slice(-300)}`, 404);
    }
    return res.stdout;
  }

  snapshot(): Promise<SnapshotRef> {
    throw new PraxisError("SANDBOX_ERROR", "snapshot/restore is not supported on the docker backend", 501);
  }
  restore(): Promise<SandboxHandle> {
    throw new PraxisError("SANDBOX_ERROR", "snapshot/restore is not supported on the docker backend", 501);
  }

  async release(handle: SandboxHandle): Promise<void> {
    await run(["docker", "rm", "-f", handle.id], { timeoutMs: 20_000 });
  }

  async poolStats() {
    const res = await run(
      ["docker", "ps", "-a", "--filter", "label=praxis.sandbox=1", "--format", "{{.State}}"],
      { timeoutMs: 10_000 },
    );
    const states = res.stdout.trim().split("\n").filter(Boolean);
    return {
      total: states.length,
      warm: 0,
      leased: states.filter((s) => s === "running").length,
      failed: states.filter((s) => s === "exited" || s === "dead").length,
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    const res = await run(["docker", "version", "--format", "{{.Server.Version}}"], { timeoutMs: 8_000 });
    return res.code === 0
      ? { status: "healthy", checkedAt: new Date().toISOString(), detail: `docker ${res.stdout.trim()}` }
      : { status: "down", checkedAt: new Date().toISOString(), detail: res.stderr.slice(-200) };
  }
}
