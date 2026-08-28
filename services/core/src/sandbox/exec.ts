import { spawn } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
  durationMs: number;
}

const MAX_BUFFER = 512 * 1024; // 512 KB captured per stream

/** Thin wrapper over child_process.spawn with a hard timeout and bounded buffers. */
export function run(
  cmd: string[],
  opts: { input?: string | Buffer; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  const [bin, ...args] = cmd;
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env: { ...process.env, ...opts.env } });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;

    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < MAX_BUFFER) stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < MAX_BUFFER) stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String(err), code: 127, timedOut, durationMs: Date.now() - started });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 0, timedOut, durationMs: Date.now() - started });
    });

    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}

export async function* runStream(
  cmd: string[],
  opts: { timeoutMs?: number } = {},
): AsyncGenerator<{ stream: "stdout" | "stderr"; data: string }> {
  const [bin, ...args] = cmd;
  const child = spawn(bin, args);
  const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;

  const queue: { stream: "stdout" | "stderr"; data: string }[] = [];
  let done = false;
  let notify: (() => void) | null = null;

  const push = (stream: "stdout" | "stderr") => (d: Buffer) => {
    queue.push({ stream, data: d.toString("utf8") });
    notify?.();
  };
  child.stdout.on("data", push("stdout"));
  child.stderr.on("data", push("stderr"));
  child.on("close", () => {
    if (timer) clearTimeout(timer);
    done = true;
    notify?.();
  });

  while (!done || queue.length) {
    if (!queue.length) await new Promise<void>((r) => (notify = r));
    while (queue.length) yield queue.shift()!;
  }
}
