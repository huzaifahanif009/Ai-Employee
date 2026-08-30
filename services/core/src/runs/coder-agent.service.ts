import { Injectable, Logger } from "@nestjs/common";

/**
 * The "brain" of a Run: turns a work item + the real repository into a concrete
 * plan and then into real file changes, using the tenant's model through the
 * Model Router. It holds no infrastructure — the driver passes in `ask` (a
 * model call) and file-access callbacks — so it unit-tests with fakes.
 */

export interface WorkItemLike {
  title: string;
  bodyMd?: string | null;
  acceptanceCriteria?: string[] | null;
}

export type StepKind = "create" | "edit" | "delete";

export interface AgentStep {
  index: number;
  title: string;
  rationale: string;
  files: string[];
  kind: StepKind;
}

export interface AgentPlan {
  summary: string;
  risk: "low" | "medium" | "high";
  steps: AgentStep[];
}

export interface RepoContext {
  greenfield: boolean;
  stack: "node" | "python" | "static-web" | "unknown";
  fileTree: string[];
  digest: string;
  testCommand: string | null;
  buildCommand: string | null;
}

export interface GeneratedFile {
  path: string;
  content: string;
  action: "create" | "edit" | "delete";
}

export interface AgentReview {
  verdict: "pass" | "warn" | "fail";
  summary: string;
  findings: { severity: "info" | "warn" | "error"; message: string }[];
}

export type AskFn = (opts: {
  purpose: "plan" | "code" | "review";
  routingClass: "fast" | "strong" | "code";
  system: string;
  user: string;
  maxOutputTokens?: number;
  json?: boolean;
  stepId?: string;
}) => Promise<string>;

export interface RepoIo {
  /** `git ls-files`-style listing (newline separated) */
  listFiles: () => Promise<string>;
  readFile: (path: string) => Promise<string | null>;
  sh: (command: string) => Promise<{ ok: boolean; output: string }>;
}

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|c|cc|cpp|h|hpp|cs|html|css|scss|vue|svelte|sql)$/i;
const MAX_FILE_BYTES = 24_000;
const MAX_STEPS = 6;
const MAX_FILES_PER_STEP = 6;

@Injectable()
export class CoderAgentService {
  private readonly log = new Logger("CoderAgent");

  // ── repo analysis ─────────────────────────────────────────────────────────
  async analyzeRepo(io: RepoIo): Promise<RepoContext> {
    const listing = (await io.listFiles().catch(() => "")).trim();
    const fileTree = listing ? listing.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];

    const has = (re: RegExp) => fileTree.some((f) => re.test(f));
    const codeFiles = fileTree.filter((f) => CODE_EXT.test(f) && !/^(PRAXIS_NOTES\.md)$/i.test(f));
    const greenfield = codeFiles.length === 0;

    let stack: RepoContext["stack"] = "unknown";
    if (has(/(^|\/)package\.json$/)) stack = "node";
    else if (has(/(^|\/)(requirements\.txt|pyproject\.toml|setup\.py)$/)) stack = "python";
    else if (has(/(^|\/)index\.html$/)) stack = "static-web";

    // read a handful of orienting files
    const pref = [
      "package.json",
      "README.md",
      "pyproject.toml",
      "requirements.txt",
      "index.html",
      "tsconfig.json",
    ];
    const extras = codeFiles
      .filter((f) => !pref.includes(f))
      .sort((a, b) => a.length - b.length)
      .slice(0, 6);

    const snippets: string[] = [];
    let budget = 12_000;
    for (const path of [...pref, ...extras]) {
      if (budget <= 0) break;
      if (!fileTree.includes(path) && !pref.includes(path)) continue;
      const body = await io.readFile(path).catch(() => null);
      if (!body) continue;
      const clipped = body.length > 4000 ? body.slice(0, 4000) + "\n… (truncated)" : body;
      snippets.push(`--- ${path} ---\n${clipped}`);
      budget -= clipped.length;
    }

    let pkg: Record<string, unknown> | null = null;
    if (stack === "node") {
      try {
        pkg = JSON.parse((await io.readFile("package.json")) ?? "null");
      } catch {
        pkg = null;
      }
    }
    const scripts = (pkg?.scripts as Record<string, string> | undefined) ?? {};
    const testCommand =
      stack === "node"
        ? scripts.test && !/no test specified/i.test(scripts.test)
          ? "npm test --silent"
          : null
        : stack === "python"
          ? "pytest -q"
          : null;
    const buildCommand = stack === "node" && scripts.build ? "npm run build" : null;

    const digest = [
      `Stack: ${stack}${greenfield ? " (greenfield — repo has no source files yet)" : ""}`,
      `Files (${fileTree.length}):`,
      fileTree.slice(0, 120).map((f) => `  ${f}`).join("\n") || "  (none)",
      "",
      snippets.join("\n\n"),
    ].join("\n");

    return { greenfield, stack, fileTree, digest, testCommand, buildCommand };
  }

  // ── planning ──────────────────────────────────────────────────────────────
  async plan(
    ask: AskFn,
    workItem: WorkItemLike,
    repo: RepoContext,
    reviewerNote?: string,
  ): Promise<AgentPlan> {
    const system =
      "You are a senior engineer planning a change to a real Git repository. " +
      "Respond ONLY with JSON matching: " +
      `{"summary": string, "risk": "low"|"medium"|"high", "steps": [{"title": string, "rationale": string, "files": string[], "kind": "create"|"edit"|"delete"}]}. ` +
      "Each step must touch specific real file paths (relative to repo root). Keep to 1-5 focused steps. " +
      "If the repo is greenfield, the first steps scaffold the project (entry point, config, minimal structure). " +
      "For a browser project with no bundler, keep script/style paths consistent with how the HTML references them " +
      "(prefer flat paths, and if you add tests also add the minimal package.json needed to run them). " +
      "Do NOT include steps for CI config, licenses, or unrelated cleanup.";

    const user = [
      `WORK ITEM: ${workItem.title}`,
      workItem.bodyMd ? `\nDETAILS:\n${workItem.bodyMd}` : "",
      workItem.acceptanceCriteria?.length
        ? `\nACCEPTANCE CRITERIA:\n${workItem.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`
        : "",
      reviewerNote ? `\nREVIEWER ASKED TO REPLAN: ${reviewerNote}` : "",
      `\nREPOSITORY CONTEXT:\n${repo.digest}`,
    ].join("\n");

    let raw = await ask({ purpose: "plan", routingClass: "strong", system, user, json: true, maxOutputTokens: 3200 });
    let parsed = extractJson<Partial<AgentPlan>>(raw);
    if (!parsed?.steps?.some((s) => Array.isArray(s?.files) && s.files.length)) {
      // one retry with a firmer nudge — the first reply had no usable steps
      raw = await ask({
        purpose: "plan",
        routingClass: "strong",
        system,
        user: user + "\n\nReturn 2-5 steps. Every step MUST list at least one concrete file path.",
        json: true,
        maxOutputTokens: 3200,
      });
      parsed = extractJson<Partial<AgentPlan>>(raw) ?? parsed;
    }
    const steps = (parsed?.steps ?? [])
      .slice(0, MAX_STEPS)
      .map((s, i) => ({
        index: i + 1,
        title: String(s?.title ?? `Step ${i + 1}`).slice(0, 160),
        rationale: String(s?.rationale ?? "").slice(0, 400),
        files: (Array.isArray(s?.files) ? s!.files : [])
          .map((f) => String(f).replace(/^\.?\//, "").trim())
          .filter(Boolean)
          .slice(0, MAX_FILES_PER_STEP),
        kind: (["create", "edit", "delete"] as StepKind[]).includes(s?.kind as StepKind)
          ? (s!.kind as StepKind)
          : "edit",
      }))
      .filter((s) => s.files.length > 0);

    if (steps.length === 0) {
      // never leave a run planless — fall back to a single scaffold/impl step
      steps.push({
        index: 1,
        title: `Implement: ${workItem.title}`.slice(0, 160),
        rationale: "Model returned no usable plan; single-step fallback.",
        files: repo.greenfield ? ["README.md"] : [repo.fileTree[0] ?? "README.md"],
        kind: repo.greenfield ? "create" : "edit",
      });
    }

    return {
      summary: String(parsed?.summary ?? workItem.title).slice(0, 400),
      risk: (["low", "medium", "high"] as const).includes(parsed?.risk as never)
        ? (parsed!.risk as AgentPlan["risk"])
        : "medium",
      steps,
    };
  }

  // ── implementation ────────────────────────────────────────────────────────
  async implementStep(
    ask: AskFn,
    io: Pick<RepoIo, "readFile">,
    step: AgentStep,
    workItem: WorkItemLike,
    repo: RepoContext,
  ): Promise<GeneratedFile[]> {
    if (step.kind === "delete") {
      return step.files.map((path) => ({ path, content: "", action: "delete" as const }));
    }

    const current: string[] = [];
    for (const path of step.files) {
      const body = await io.readFile(path).catch(() => null);
      current.push(
        body == null
          ? `--- ${path} --- (does not exist yet — create it)`
          : `--- ${path} ---\n${body.length > 6000 ? body.slice(0, 6000) + "\n… (truncated)" : body}`,
      );
    }

    const system =
      "You are a senior engineer implementing ONE step of an approved plan in a real repo. " +
      "Respond ONLY with JSON: " +
      `{"files": [{"path": string, "content": string, "action": "create"|"edit"}], "notes": string}. ` +
      "`content` is the COMPLETE new contents of the file (not a diff). Only include files that actually change. " +
      "Write idiomatic, working code consistent with the repo's stack and style. No placeholders or TODOs for the core behaviour.";

    const user = [
      `WORK ITEM: ${workItem.title}`,
      workItem.acceptanceCriteria?.length
        ? `ACCEPTANCE CRITERIA:\n${workItem.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`
        : "",
      `\nSTACK: ${repo.stack}${repo.greenfield ? " (greenfield)" : ""}`,
      `\nSTEP ${step.index}: ${step.title}`,
      step.rationale ? `WHY: ${step.rationale}` : "",
      `TARGET FILES: ${step.files.join(", ")}`,
      `\nCURRENT FILE CONTENTS:\n${current.join("\n\n")}`,
    ].join("\n");

    const raw = await ask({
      purpose: "code",
      routingClass: "code",
      system,
      user,
      json: true,
      maxOutputTokens: 8000,
      stepId: `${step.index}`,
    });
    const parsed = extractJson<{ files?: { path?: string; content?: string; action?: string }[] }>(raw);

    const out: GeneratedFile[] = [];
    for (const f of parsed?.files ?? []) {
      const path = String(f?.path ?? "").replace(/^\.?\//, "").trim();
      if (!path || path.includes("..") || path.startsWith("/")) continue;
      if (typeof f?.content !== "string") continue;
      if (f.content.length > MAX_FILE_BYTES) continue;
      out.push({
        path,
        content: f.content,
        action: f.action === "create" || !repo.fileTree.includes(path) ? "create" : "edit",
      });
      if (out.length >= MAX_FILES_PER_STEP) break;
    }
    return out;
  }

  // ── review ────────────────────────────────────────────────────────────────
  async review(ask: AskFn, workItem: WorkItemLike, diff: string): Promise<AgentReview> {
    if (!diff.trim()) {
      return {
        verdict: "fail",
        summary: "No changes were produced.",
        findings: [{ severity: "error", message: "The diff is empty — nothing was implemented." }],
      };
    }
    const system =
      "You are reviewing a pull request diff against its work item. Respond ONLY with JSON: " +
      `{"verdict": "pass"|"warn"|"fail", "summary": string, "findings": [{"severity": "info"|"warn"|"error", "message": string}]}. ` +
      "`fail` only for missing core functionality or broken code. `warn` for gaps worth noting. Be concise.";
    const user = [
      `WORK ITEM: ${workItem.title}`,
      workItem.acceptanceCriteria?.length
        ? `ACCEPTANCE CRITERIA:\n${workItem.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`
        : "",
      `\nDIFF:\n${diff.length > 18_000 ? diff.slice(0, 18_000) + "\n… (truncated)" : diff}`,
    ].join("\n");

    const raw = await ask({ purpose: "review", routingClass: "strong", system, user, json: true, maxOutputTokens: 2200 });
    const p = extractJson<Partial<AgentReview>>(raw);
    return {
      verdict: (["pass", "warn", "fail"] as const).includes(p?.verdict as never) ? (p!.verdict as AgentReview["verdict"]) : "warn",
      summary: String(p?.summary ?? "").slice(0, 600),
      findings: (p?.findings ?? [])
        .slice(0, 10)
        .map((f) => ({
          severity: (["info", "warn", "error"] as const).includes(f?.severity as never) ? (f!.severity as "info") : "info",
          message: String(f?.message ?? "").slice(0, 300),
        }))
        .filter((f) => f.message),
    };
  }

  /** normalise a plan that came back edited from the approval gate */
  sanitizePlan(raw: unknown): AgentStep[] {
    const arr = Array.isArray(raw) ? raw : [];
    return arr
      .slice(0, MAX_STEPS)
      .map((s, i) => {
        const o = s as Partial<AgentStep>;
        return {
          index: i + 1,
          title: String(o?.title ?? `Step ${i + 1}`).slice(0, 160),
          rationale: String(o?.rationale ?? "").slice(0, 400),
          files: (Array.isArray(o?.files) ? o!.files : [])
            .map((f) => String(f).replace(/^\.?\//, "").trim())
            .filter(Boolean)
            .slice(0, MAX_FILES_PER_STEP),
          kind: (["create", "edit", "delete"] as StepKind[]).includes(o?.kind as StepKind) ? (o!.kind as StepKind) : "edit",
        };
      })
      .filter((s) => s.files.length > 0);
  }
}

/** Pull the first JSON object out of a model reply (handles ```json fences and prose). */
export function extractJson<T>(text: string): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  for (let cut = end; cut > start; cut = candidate.lastIndexOf("}", cut - 1)) {
    try {
      return JSON.parse(candidate.slice(start, cut + 1)) as T;
    } catch {
      /* try a shorter slice */
    }
  }
  return null;
}
