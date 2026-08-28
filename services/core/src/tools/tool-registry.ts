import type { RiskTier } from "@praxis/contracts";

export interface NativeTool {
  name: string;
  description: string;
  execution: "sandbox" | "control-plane";
  riskTier: RiskTier;
  idempotent: boolean;
  timeoutMs: number;
  untrustedOutput?: boolean;
  /** JSON-schema-ish; kept light for now */
  input: Record<string, "string" | "string?" | "string[]?" | "boolean?">;
}

/** prd/09 §4 — native tool catalog (v1 subset). vcs.* / connector tools land with the connectors. */
export const NATIVE_TOOLS: NativeTool[] = [
  { name: "shell.exec", description: "Run a shell command in the workspace", execution: "sandbox", riskTier: "notify", idempotent: false, timeoutMs: 120_000, input: { command: "string", cwd: "string?" } },
  { name: "fs.read", description: "Read a file (bounded)", execution: "sandbox", riskTier: "auto", idempotent: true, timeoutMs: 15_000, input: { path: "string", maxBytes: "string?" } },
  { name: "fs.write", description: "Write/overwrite a file", execution: "sandbox", riskTier: "notify", idempotent: false, timeoutMs: 15_000, input: { path: "string", content: "string" } },
  { name: "fs.list", description: "List a directory", execution: "sandbox", riskTier: "auto", idempotent: true, timeoutMs: 15_000, input: { path: "string?" } },
  { name: "code.search", description: "ripgrep the workspace", execution: "sandbox", riskTier: "auto", idempotent: true, timeoutMs: 30_000, untrustedOutput: true, input: { query: "string", path: "string?" } },
  { name: "test.run", description: "Run the project's test command", execution: "sandbox", riskTier: "auto", idempotent: true, timeoutMs: 600_000, input: { command: "string?" } },
  { name: "git.status", description: "git status --porcelain", execution: "sandbox", riskTier: "auto", idempotent: true, timeoutMs: 15_000, input: {} },
  { name: "git.diff", description: "git diff", execution: "sandbox", riskTier: "auto", idempotent: true, timeoutMs: 15_000, input: { staged: "boolean?" } },
  { name: "git.branch", description: "Create + switch to a branch", execution: "sandbox", riskTier: "auto", idempotent: false, timeoutMs: 15_000, input: { name: "string" } },
  { name: "git.add", description: "Stage paths", execution: "sandbox", riskTier: "auto", idempotent: false, timeoutMs: 15_000, input: { paths: "string[]?" } },
  { name: "git.commit", description: "Commit staged changes", execution: "sandbox", riskTier: "auto", idempotent: false, timeoutMs: 15_000, input: { message: "string" } },
  { name: "git.log", description: "Recent history", execution: "sandbox", riskTier: "auto", idempotent: true, timeoutMs: 15_000, input: {} },
  { name: "git.push", description: "Push a branch (requires a VCS connector)", execution: "control-plane", riskTier: "forbidden", idempotent: false, timeoutMs: 60_000, input: {} },
];

export const toolByName = (name: string): NativeTool | undefined =>
  NATIVE_TOOLS.find((t) => t.name === name);

/** Path guard for fs.write / fs.delete (prd/06 §7). Relative, inside the workspace, never .git internals or CI config. */
export function isWriteAllowed(path: string): { ok: boolean; reason?: string } {
  const p = path.replace(/\\/g, "/");
  if (p.startsWith("/") && !p.startsWith("/workspace")) return { ok: false, reason: "absolute path outside /workspace" };
  if (p.includes("..")) return { ok: false, reason: "path traversal" };
  if (/(^|\/)\.git\//.test(p)) return { ok: false, reason: "writes to .git/** are not allowed" };
  if (/(^|\/)\.github\//.test(p) || /(^|\/)\.gitlab-ci\.yml$/.test(p)) {
    return { ok: false, reason: "CI config is protected (needs an explicit policy allowlist + approval)" };
  }
  return { ok: true };
}
