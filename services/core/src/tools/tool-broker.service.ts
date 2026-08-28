import { createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { PraxisError } from "@praxis/contracts";
import type { RiskTier, SandboxHandle, SandboxProvider } from "@praxis/contracts";
import { DataSource, Repository } from "typeorm";
import { ApprovalGateService } from "../approvals/approval-gate.service";
import { AppConfig, CONFIG } from "../config/config";
import { ToolCallEntity } from "../database/entities";
import { RunEventsService } from "../events/run-events.service";
import { SANDBOX_PROVIDER } from "../sandbox/sandbox.module";
import { isWriteAllowed, NATIVE_TOOLS, toolByName } from "./tool-registry";

export interface ToolCtx {
  tenantId: string;
  projectId: string;
  runId: string;
  stepId?: string;
  agentRole?: string;
  sandbox: SandboxHandle;
  /** where the repo lives inside the sandbox */
  repoDir: string;
  /** project test command, for test.run */
  testCommand?: string;
  /** raised policy tiers per tool (from Project Policy — flat map for now) */
  policyTiers?: Record<string, RiskTier>;
}

export interface ToolResult {
  status: "ok" | "error" | "denied" | "needs_approval";
  outputPreview: string;
  durationMs: number;
  bytesOut: number;
  error?: string;
}

const TIER_ORDER: RiskTier[] = ["auto", "notify", "approve", "forbidden"];
const maxTier = (a: RiskTier, b: RiskTier): RiskTier =>
  TIER_ORDER[Math.max(TIER_ORDER.indexOf(a), TIER_ORDER.indexOf(b))];

@Injectable()
export class ToolBrokerService {
  private readonly log = new Logger("ToolBroker");

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(SANDBOX_PROVIDER) private readonly sandbox: SandboxProvider,
    @InjectRepository(ToolCallEntity) private readonly repo: Repository<ToolCallEntity>,
    private readonly ds: DataSource,
    private readonly events: RunEventsService,
    private readonly gate: ApprovalGateService,
  ) {}

  list() {
    return NATIVE_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      execution: t.execution,
      riskTier: t.riskTier,
      idempotent: t.idempotent,
    }));
  }

  async call(ctx: ToolCtx, toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    const def = toolByName(toolName);
    if (!def) throw new PraxisError("VALIDATION", `unknown tool: ${toolName}`, 400);

    const effectiveTier = maxTier(def.riskTier, ctx.policyTiers?.[toolName] ?? "auto");
    const seq = await this.nextSeq(ctx.runId);
    const inputHash = sha(JSON.stringify({ toolName, input }));

    await this.events.append({
      tenantId: ctx.tenantId,
      runId: ctx.runId,
      type: "tool_call.started",
      payload: {
        stepId: ctx.stepId,
        toolCallId: `${ctx.runId}-tc${seq}`,
        tool: toolName,
        argsPreview: previewArgs(toolName, input),
        riskTier: effectiveTier,
      },
    });

    let result: ToolResult;

    if (effectiveTier === "forbidden") {
      result = { status: "denied", outputPreview: `tool ${toolName} is forbidden by policy`, durationMs: 0, bytesOut: 0, error: "forbidden" };
    } else if (effectiveTier === "approve") {
      const decision = await this.gate.raiseAndWait({
        tenantId: ctx.tenantId,
        runId: ctx.runId,
        runStepId: ctx.stepId,
        type: "risky_action",
        evidence: { summary: `Agent wants to run ${toolName}`, args: previewArgs(toolName, input) },
        actionPreview: { action: toolName, input },
      });
      result =
        decision.decision === "reject"
          ? { status: "denied", outputPreview: `rejected: ${decision.note ?? ""}`, durationMs: 0, bytesOut: 0, error: "rejected" }
          : await this.dispatch(ctx, def.name, input);
    } else {
      result = await this.dispatch(ctx, def.name, input);
    }

    await this.repo.save(
      this.repo.create({
        tenantId: ctx.tenantId,
        runId: ctx.runId,
        runStepId: ctx.stepId ?? null,
        seq,
        toolName,
        execution: def.execution,
        riskTier: effectiveTier,
        input,
        inputHash,
        outputPreview: result.outputPreview.slice(0, 4000),
        status: result.status,
        durationMs: result.durationMs,
        bytesOut: result.bytesOut,
        error: result.error ?? null,
      }),
    );

    await this.events.append({
      tenantId: ctx.tenantId,
      runId: ctx.runId,
      type: "tool_call.finished",
      payload: {
        stepId: ctx.stepId,
        toolCallId: `${ctx.runId}-tc${seq}`,
        tool: toolName,
        status: result.status,
        durationMs: result.durationMs,
        bytesOut: result.bytesOut,
        outputPreview: result.outputPreview.slice(0, 400),
      },
    });

    return result;
  }

  // ---------------------------------------------------------------------------

  private async dispatch(ctx: ToolCtx, tool: string, input: Record<string, unknown>): Promise<ToolResult> {
    const s = this.sandbox;
    const h = ctx.sandbox;
    const cwd = ctx.repoDir;
    const str = (k: string, d = "") => (typeof input[k] === "string" ? (input[k] as string) : d);

    try {
      switch (tool) {
        case "fs.read": {
          const t0 = Date.now();
          const out = await s.readFile(h, absolute(cwd, str("path")), Number(input.maxBytes) || 200_000);
          return ok(out, Date.now() - t0);
        }
        case "fs.write": {
          const path = str("path");
          const guard = isWriteAllowed(path);
          if (!guard.ok) return { status: "denied", outputPreview: guard.reason!, durationMs: 0, bytesOut: 0, error: guard.reason };
          const t0 = Date.now();
          await s.writeFile(h, absolute(cwd, path), Buffer.from(str("content"), "utf8").toString("base64"));
          return ok(`wrote ${path}`, Date.now() - t0);
        }
        case "fs.list":
          return this.sh(s, h, cwd, `ls -la ${shq(str("path", "."))}`);
        case "code.search":
          return this.sh(s, h, cwd, `rg -n --no-heading -- ${shq(str("query"))} ${shq(str("path", "."))} || true`);
        case "shell.exec":
          return this.sh(s, h, str("cwd", cwd), str("command"), 120_000);
        case "test.run":
          return this.sh(s, h, cwd, str("command", ctx.testCommand || "npm test --silent"), 600_000);
        case "git.status":
          return this.sh(s, h, cwd, "git status --porcelain=v1");
        case "git.diff":
          return this.sh(s, h, cwd, `git --no-pager diff ${input.staged ? "--staged" : ""}`);
        case "git.branch":
          return this.sh(s, h, cwd, `git checkout -b ${shq(str("name"))}`);
        case "git.add": {
          const paths = Array.isArray(input.paths) && input.paths.length ? (input.paths as string[]).map(shq).join(" ") : "-A";
          return this.sh(s, h, cwd, `git add ${paths}`);
        }
        case "git.commit":
          return this.sh(s, h, cwd, `git commit -m ${shq(str("message"))}`);
        case "git.log":
          return this.sh(s, h, cwd, "git --no-pager log --oneline -n 20");
        default:
          return { status: "error", outputPreview: `no dispatcher for ${tool}`, durationMs: 0, bytesOut: 0, error: "unimplemented" };
      }
    } catch (err) {
      return { status: "error", outputPreview: (err as Error).message, durationMs: 0, bytesOut: 0, error: (err as Error).message };
    }
  }

  private async sh(
    s: SandboxProvider,
    h: SandboxHandle,
    cwd: string,
    command: string,
    timeoutMs = 60_000,
  ): Promise<ToolResult> {
    const res = await s.execCollect(h, { cmd: ["sh", "-lc", command], cwd, timeoutMs });
    return {
      status: res.exitCode === 0 ? "ok" : "error",
      outputPreview: res.output || `(exit ${res.exitCode})`,
      durationMs: res.durationMs,
      bytesOut: Buffer.byteLength(res.output),
      error: res.exitCode === 0 ? undefined : `exit ${res.exitCode}`,
    };
  }

  private async nextSeq(runId: string): Promise<number> {
    return this.ds.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`tc:${runId}`]);
      const { max } = (await m
        .createQueryBuilder(ToolCallEntity, "t")
        .select("COALESCE(MAX(t.seq),0)", "max")
        .where("t.runId = :runId", { runId })
        .getRawOne()) as { max: string };
      return Number(max) + 1;
    });
  }

  ledgerForRun(tenantId: string, runId: string) {
    return this.repo.find({ where: { tenantId, runId }, order: { seq: "ASC" } });
  }
}

const ok = (output: string, durationMs: number): ToolResult => ({
  status: "ok",
  outputPreview: output,
  durationMs,
  bytesOut: Buffer.byteLength(output),
});
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const absolute = (cwd: string, p: string) => (p.startsWith("/") ? p : `${cwd.replace(/\/$/, "")}/${p}`);
const previewArgs = (tool: string, input: Record<string, unknown>) =>
  JSON.stringify(input).slice(0, 200);
