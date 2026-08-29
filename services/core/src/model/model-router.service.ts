import { createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { budgetExceeded, PraxisError } from "@praxis/contracts";
import type {
  ModelCatalogEntry,
  ModelRequest,
  ModelResponse,
  ModelRouter,
  NormalizedStreamEvent,
  RouteAttempt,
} from "@praxis/contracts";
import Redis from "ioredis";
import { Repository } from "typeorm";
import { AiRegistryService, ResolvedModel } from "../ai/ai-registry.service";
import { clientForKind } from "../ai/provider-clients";
import { ApprovalGateService } from "../approvals/approval-gate.service";
import { AppConfig, CONFIG } from "../config/config";
import { ModelCallEntity, RunEntity } from "../database/entities";
import { RunEventsService } from "../events/run-events.service";
import { checkBudget, estimateCostUsd, estimateTokens } from "./budget";
import { redactMessages } from "./redaction";

interface OpenAIChatResponse {
  choices: {
    message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };
    finish_reason: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  model?: string;
}

/** Synthetic zero-cost fallback model — always available via the LiteLLM mock. */
const STUB = { model: "praxis-stub", maxOutput: 4000 };

@Injectable()
export class ModelRouterService implements ModelRouter {
  private readonly log = new Logger("ModelRouter");
  private readonly redis: Redis;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectRepository(ModelCallEntity) private readonly ledger: Repository<ModelCallEntity>,
    @InjectRepository(RunEntity) private readonly runs: Repository<RunEntity>,
    private readonly events: RunEventsService,
    private readonly gate: ApprovalGateService,
    private readonly ai: AiRegistryService,
  ) {
    this.redis = new Redis(cfg.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  }

  /** legacy — the real per-tenant catalog is GET /ai/models */
  catalog(): Promise<ModelCatalogEntry[]> {
    return Promise.resolve([]);
  }

  async healthCheck() {
    const started = Date.now();
    try {
      const r = await fetch(`${this.cfg.litellmBaseUrl}/health/liveliness`, { signal: AbortSignal.timeout(3000) });
      return { status: r.ok ? ("healthy" as const) : ("degraded" as const), checkedAt: new Date().toISOString(), latencyMs: Date.now() - started };
    } catch (e) {
      return { status: "down" as const, checkedAt: new Date().toISOString(), detail: (e as Error).message };
    }
  }

  async *stream(req: ModelRequest): AsyncIterable<NormalizedStreamEvent> {
    const res = await this.complete(req);
    const text = res.content.map((p) => ("text" in p ? p.text : "")).join("");
    for (let i = 0; i < text.length; i += 120) yield { type: "message.delta", text: text.slice(i, i + 120) };
    yield { type: "usage", usage: res.usage };
    yield { type: "done", response: res };
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    if (!req.attribution?.tenantId || !req.attribution?.projectId) {
      throw new PraxisError("VALIDATION", "model request is missing attribution", 400);
    }
    const t0 = Date.now();
    const tenantId = req.attribution.tenantId;

    // resolve a tenant-configured model (DB) — null = fall back to the stub
    const resolved = await this.ai
      .resolve(tenantId, { modelHint: req.modelHint, routingClass: req.routingClass, purpose: req.purpose })
      .catch((e) => {
        this.log.warn(`resolve: ${(e as Error).message}`);
        return null;
      });

    // redact: known secret patterns + every configured provider key for this tenant
    const providerSecrets = await this.ai.allActiveSecrets(tenantId).catch(() => []);
    const { messages: redacted, redacted: redactedSpans } = redactMessages(
      req.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : m.content.map((p) => ("text" in p ? p.text : "")).join("\n"),
      })),
      providerSecrets,
    );

    const modelTag = resolved ? `${resolved.providerKind}:${resolved.providerModel}` : "stub";
    const priceIn = resolved?.priceInputPerMTok ?? 0;
    const priceOut = resolved?.priceOutputPerMTok ?? 0;
    const maxOut = req.maxOutputTokens ?? resolved?.maxOutput ?? 2048;

    // exact cache
    const cacheKey =
      req.cache?.mode === "exact"
        ? `praxis:mcache:${sha(modelTag + JSON.stringify(redacted) + (req.temperature ?? "") + (req.responseFormat ?? ""))}`
        : null;
    if (cacheKey) {
      const hit = await this.redis.get(cacheKey).catch(() => null);
      if (hit) {
        const cached = JSON.parse(hit) as ModelResponse;
        cached.usage.costUsd = 0;
        cached.routing = { attempts: [], cacheHit: "exact" };
        await this.record(req, cached, redactedSpans, "exact", []);
        return cached;
      }
    }

    // budget
    const inputTokens = redacted.reduce((s, m) => s + estimateTokens(String(m.content)), 0);
    const estCost = estimateCostUsd(inputTokens, maxOut, priceIn, priceOut);
    if (req.attribution.runId) await this.enforceBudget(req, estCost, inputTokens);

    if (req.attribution.runId) {
      await this.events.append({
        tenantId,
        runId: req.attribution.runId,
        type: "model_call.started",
        payload: { purpose: req.purpose, routingClass: req.routingClass, model: resolved?.alias ?? "stub" },
      });
    }

    const attempts: RouteAttempt[] = [];

    // 1) configured provider (direct)
    if (resolved) {
      const started = Date.now();
      try {
        const response = await this.callDirect(resolved, redacted, req, maxOut, priceIn, priceOut, t0);
        attempts.push({ provider: resolved.providerKind, model: resolved.providerModel, attempt: 1, outcome: "ok", latencyMs: Date.now() - started });
        response.routing = { attempts, cacheHit: null };
        if (cacheKey) await this.redis.set(cacheKey, JSON.stringify(response), "EX", req.cache?.ttlSeconds ?? 900).catch(() => undefined);
        await this.record(req, response, redactedSpans, "none", attempts);
        return response;
      } catch (err) {
        const status = (err as { status?: number }).status ?? 0;
        attempts.push({
          provider: resolved.providerKind,
          model: resolved.providerModel,
          attempt: 1,
          outcome: status >= 400 && status < 500 && status !== 429 ? "fatal_error" : "retryable_error",
          reason: (err as Error).message,
          latencyMs: Date.now() - started,
        });
        if (req.attribution.runId) {
          await this.events.append({
            tenantId,
            runId: req.attribution.runId,
            type: "model_call.fallback",
            payload: { fromModel: resolved.providerModel, toModel: STUB.model, reason: (err as Error).message },
          });
        }
      }
    }

    // 2) stub via LiteLLM
    const started = Date.now();
    try {
      const raw = await this.callLiteLLM(STUB, redacted, req);
      const response = this.fromOpenAI(raw, "litellm", STUB.model, 0, t0);
      attempts.push({ provider: "litellm", model: STUB.model, attempt: attempts.length + 1, outcome: "ok", latencyMs: Date.now() - started });
      response.routing = { attempts, cacheHit: null };
      await this.record(req, response, redactedSpans, "none", attempts);
      return response;
    } catch (err) {
      attempts.push({ provider: "litellm", model: STUB.model, attempt: attempts.length + 1, outcome: "fatal_error", reason: (err as Error).message, latencyMs: Date.now() - started });
      throw new PraxisError("PROVIDER_UNAVAILABLE", `all model routes failed: ${(err as Error).message}`, 503, { attempts });
    }
  }

  // ---------------------------------------------------------------------------

  private async callDirect(
    resolved: ResolvedModel,
    messages: { role: string; content: string }[],
    req: ModelRequest,
    maxOut: number,
    priceIn: number,
    priceOut: number,
    t0: number,
  ): Promise<ModelResponse> {
    const r = await clientForKind(resolved.providerKind).chat({
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.providerModel,
      config: resolved.config,
      messages,
      temperature: req.temperature,
      maxOutputTokens: maxOut,
      responseFormat: req.responseFormat === "json" ? "json" : "text",
      timeoutMs: req.timeoutMs ?? 60_000,
    });
    const costUsd = +(
      ((r.usage.inputTokens - r.usage.cachedInputTokens) / 1_000_000) * priceIn +
      (r.usage.outputTokens / 1_000_000) * priceOut
    ).toFixed(6);
    return {
      model: r.model,
      provider: resolved.providerKind,
      content: [{ type: "text", text: r.text }],
      toolCalls: r.toolCalls,
      finishReason: (r.finishReason as ModelResponse["finishReason"]) ?? "stop",
      usage: {
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        cachedInputTokens: r.usage.cachedInputTokens,
        costUsd,
      },
      routing: { attempts: [], cacheHit: null },
      latencyMs: Date.now() - t0,
    };
  }

  private fromOpenAI(raw: OpenAIChatResponse, provider: string, model: string, costUsd: number, t0: number): ModelResponse {
    const usage = raw.usage ?? {};
    return {
      model: raw.model ?? model,
      provider,
      content: [{ type: "text", text: raw.choices?.[0]?.message?.content ?? "" }],
      toolCalls: raw.choices?.[0]?.message?.tool_calls?.map((tc) => ({ id: tc.id, name: tc.function.name, arguments: safeJson(tc.function.arguments) })),
      finishReason: (raw.choices?.[0]?.finish_reason as ModelResponse["finishReason"]) ?? "stop",
      usage: {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        costUsd,
      },
      routing: { attempts: [], cacheHit: null },
      latencyMs: Date.now() - t0,
    };
  }

  private async enforceBudget(req: ModelRequest, estCost: number, estTokens: number) {
    const run = await this.runs.findOne({ where: { id: req.attribution.runId } });
    if (!run) return;
    const limits = { usd: Number(run.budgetSnapshot?.usd) || undefined, tokens: Number(run.budgetSnapshot?.tokens) || undefined };
    const check = checkBudget(limits, run.totals, { costUsd: estCost, tokens: estTokens });
    if (check.verdict === "ok") return;

    if (check.verdict === "hard") {
      await this.events.append({
        tenantId: req.attribution.tenantId,
        runId: run.id,
        type: "budget.threshold",
        payload: { scope: "run", scopeId: run.id, pct: 100, projectionUsd: check.projectedUsd },
      });
      throw budgetExceeded({ runId: run.id, ...check });
    }
    if ((req.budgetPolicy?.onSoftLimit ?? "raiseApproval") === "continue") return;
    await this.events.append({
      tenantId: req.attribution.tenantId,
      runId: run.id,
      type: "budget.threshold",
      payload: { scope: "run", scopeId: run.id, pct: 80, projectionUsd: check.projectedUsd },
    });
    const decision = await this.gate.raiseAndWait({
      tenantId: req.attribution.tenantId,
      runId: run.id,
      runStepId: req.attribution.stepId,
      type: "budget",
      evidence: { summary: `Run spend ${fmt(run.totals.costUsd)} of ${fmt(check.limitUsd ?? 0)} — next call ≈ ${fmt(estCost)}. Continue?`, reason: check.reason },
      actionPreview: { action: "continue_within_budget", projectedUsd: check.projectedUsd },
    });
    if (decision.decision === "reject") throw budgetExceeded({ runId: run.id, reason: "operator declined budget extension", ...check });
  }

  private async callLiteLLM(entry: { model: string; maxOutput: number }, messages: { role: string; content: string }[], req: ModelRequest): Promise<OpenAIChatResponse> {
    const res = await fetch(`${this.cfg.litellmBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.litellmMasterKey}` },
      body: JSON.stringify({
        model: entry.model,
        messages,
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxOutputTokens ?? Math.min(entry.maxOutput, 2048),
        ...(req.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(req.timeoutMs ?? 60_000),
    });
    if (!res.ok) {
      const e = new Error(`${res.status} ${await res.text().catch(() => res.statusText)}`) as Error & { status: number };
      e.status = res.status;
      throw e;
    }
    return (await res.json()) as OpenAIChatResponse;
  }

  private async record(
    req: ModelRequest,
    res: ModelResponse,
    redactedSpans: number,
    cacheHit: "none" | "exact" | "semantic",
    attempts: RouteAttempt[],
  ) {
    await this.ledger.save(
      this.ledger.create({
        tenantId: req.attribution.tenantId,
        projectId: req.attribution.projectId,
        runId: req.attribution.runId ?? null,
        runStepId: req.attribution.stepId ?? null,
        agentRole: req.attribution.agentRole ?? null,
        purpose: req.purpose,
        provider: res.provider,
        model: res.model,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        cachedInputTokens: res.usage.cachedInputTokens ?? 0,
        costUsd: String(res.usage.costUsd),
        latencyMs: res.latencyMs,
        cacheHit,
        routeAttempts: attempts,
        finishReason: res.finishReason,
        redactedSpans,
      }),
    );
    if (req.attribution.runId) {
      await this.events.append({
        tenantId: req.attribution.tenantId,
        runId: req.attribution.runId,
        type: "model_call.finished",
        payload: {
          provider: res.provider,
          model: res.model,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          costUsd: res.usage.costUsd,
          latencyMs: res.latencyMs,
          cacheHit,
          finishReason: res.finishReason,
        },
      });
    }
  }

  async ledgerForRun(tenantId: string, runId: string) {
    return this.ledger.find({ where: { tenantId, runId }, order: { createdAt: "ASC" } });
  }
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const safeJson = (s: string): Record<string, unknown> => {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};
const fmt = (n: number) => `$${n.toFixed(3)}`;
