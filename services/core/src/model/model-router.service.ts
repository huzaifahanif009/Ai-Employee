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
import { ApprovalGateService } from "../approvals/approval-gate.service";
import { AppConfig, CONFIG } from "../config/config";
import { ModelCallEntity, RunEntity } from "../database/entities";
import { RunEventsService } from "../events/run-events.service";
import { checkBudget, estimateCostUsd, estimateTokens } from "./budget";
import { activateFromEnv, byAlias, MODEL_CATALOG, resolveModel } from "./model-catalog";
import { redactMessages } from "./redaction";

interface OpenAIChatResponse {
  choices: {
    message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };
    finish_reason: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  model?: string;
}

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

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
  ) {
    activateFromEnv(process.env);
    this.redis = new Redis(cfg.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  }

  catalog(): Promise<ModelCatalogEntry[]> {
    return Promise.resolve(MODEL_CATALOG);
  }

  async healthCheck() {
    const started = Date.now();
    try {
      const r = await fetch(`${this.cfg.litellmBaseUrl}/health/liveliness`, {
        signal: AbortSignal.timeout(3000),
      });
      return {
        status: r.ok ? ("healthy" as const) : ("degraded" as const),
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
      };
    } catch (e) {
      return {
        status: "down" as const,
        checkedAt: new Date().toISOString(),
        detail: (e as Error).message,
      };
    }
  }

  async *stream(req: ModelRequest): AsyncIterable<NormalizedStreamEvent> {
    // Phase 2 slice: no true token streaming yet — run the call and emit the result in parts.
    const res = await this.complete(req);
    const text = res.content.map((p) => ("text" in p ? p.text : "")).join("");
    for (let i = 0; i < text.length; i += 120) {
      yield { type: "message.delta", text: text.slice(i, i + 120) };
    }
    yield { type: "usage", usage: res.usage };
    yield { type: "done", response: res };
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    if (!req.attribution?.tenantId || !req.attribution?.projectId) {
      throw new PraxisError("VALIDATION", "model request is missing attribution", 400);
    }
    const t0 = Date.now();
    const primary = resolveModel(req);

    // --- redact ---
    const { messages: redacted, redacted: redactedSpans } = redactMessages(
      req.messages.map((m) => ({
        role: m.role,
        content:
          typeof m.content === "string"
            ? m.content
            : m.content.map((p) => ("text" in p ? p.text : "")).join("\n"),
      })),
    );

    // --- exact cache ---
    const cacheKey =
      req.cache?.mode === "exact"
        ? `praxis:mcache:${sha(primary.model + JSON.stringify(redacted) + (req.temperature ?? "") + (req.responseFormat ?? ""))}`
        : null;
    if (cacheKey) {
      const hit = await this.redis.get(cacheKey).catch(() => null);
      if (hit) {
        const cached = JSON.parse(hit) as ModelResponse;
        cached.usage.costUsd = 0;
        cached.routing = { attempts: [], cacheHit: "exact" };
        await this.record(req, cached, 0, redactedSpans, "exact", []);
        return cached;
      }
    }

    // --- budget ---
    const inputTokens = redacted.reduce((s, m) => s + estimateTokens(String(m.content)), 0);
    const estCost = estimateCostUsd(
      inputTokens,
      req.maxOutputTokens ?? primary.maxOutput,
      primary.priceInputPerMTok,
      primary.priceOutputPerMTok,
    );
    if (req.attribution.runId) {
      await this.enforceBudget(req, estCost, inputTokens);
    }

    // --- call, with fallback chain ---
    const chain = [primary, ...(primary.fallbacks ?? []).map(byAlias).filter(Boolean) as ModelCatalogEntry[]];
    const attempts: RouteAttempt[] = [];
    let lastErr: unknown;

    if (req.attribution.runId) {
      await this.events.append({
        tenantId: req.attribution.tenantId,
        runId: req.attribution.runId,
        type: "model_call.started",
        payload: { purpose: req.purpose, routingClass: req.routingClass, model: primary.alias },
      });
    }

    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i];
      const attemptStart = Date.now();
      try {
        const raw = await this.callLiteLLM(entry, redacted, req);
        const usage = raw.usage ?? {};
        const inTok = usage.prompt_tokens ?? inputTokens;
        const outTok = usage.completion_tokens ?? 0;
        const cachedTok = usage.prompt_tokens_details?.cached_tokens ?? 0;
        const costUsd = +(
          ((inTok - cachedTok) / 1_000_000) * entry.priceInputPerMTok +
          (outTok / 1_000_000) * entry.priceOutputPerMTok
        ).toFixed(6);

        attempts.push({
          provider: entry.provider,
          model: entry.model,
          attempt: i + 1,
          outcome: "ok",
          latencyMs: Date.now() - attemptStart,
        });

        const response: ModelResponse = {
          model: raw.model ?? entry.model,
          provider: entry.provider,
          content: [{ type: "text", text: raw.choices?.[0]?.message?.content ?? "" }],
          toolCalls: raw.choices?.[0]?.message?.tool_calls?.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: safeJson(tc.function.arguments),
          })),
          finishReason: (raw.choices?.[0]?.finish_reason as ModelResponse["finishReason"]) ?? "stop",
          usage: {
            inputTokens: inTok,
            outputTokens: outTok,
            cachedInputTokens: cachedTok,
            costUsd,
          },
          routing: { attempts, cacheHit: null },
          latencyMs: Date.now() - t0,
        };

        if (cacheKey) {
          await this.redis
            .set(cacheKey, JSON.stringify(response), "EX", req.cache?.ttlSeconds ?? 900)
            .catch(() => undefined);
        }
        await this.record(req, response, redactedSpans, redactedSpans, "none", attempts);
        return response;
      } catch (err) {
        lastErr = err;
        const status = err instanceof HttpErr ? err.status : 0;
        attempts.push({
          provider: entry.provider,
          model: entry.model,
          attempt: i + 1,
          outcome: RETRYABLE.has(status) || status === 0 ? "retryable_error" : "fatal_error",
          reason: (err as Error).message,
          latencyMs: Date.now() - attemptStart,
        });
        if (status && !RETRYABLE.has(status)) break;
        if (req.attribution.runId && i < chain.length - 1) {
          await this.events.append({
            tenantId: req.attribution.tenantId,
            runId: req.attribution.runId,
            type: "model_call.fallback",
            payload: { fromModel: entry.model, toModel: chain[i + 1]?.model, reason: (err as Error).message },
          });
        }
      }
    }

    throw new PraxisError(
      "PROVIDER_UNAVAILABLE",
      `all model routes failed: ${(lastErr as Error)?.message ?? "unknown"}`,
      503,
      { attempts },
    );
  }

  // ---------------------------------------------------------------------------

  private async enforceBudget(req: ModelRequest, estCost: number, estTokens: number) {
    const run = await this.runs.findOne({ where: { id: req.attribution.runId } });
    if (!run) return;
    const limits = {
      usd: Number(run.budgetSnapshot?.usd) || undefined,
      tokens: Number(run.budgetSnapshot?.tokens) || undefined,
    };
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

    // soft → HITL gate (prd/06 §5 budget row)
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
      evidence: {
        summary: `Run spend ${fmt(run.totals.costUsd)} of ${fmt(check.limitUsd ?? 0)} — next call ≈ ${fmt(estCost)}. Continue?`,
        reason: check.reason,
      },
      actionPreview: { action: "continue_within_budget", projectedUsd: check.projectedUsd },
    });
    if (decision.decision === "reject") {
      throw budgetExceeded({ runId: run.id, reason: "operator declined budget extension", ...check });
    }
  }

  private async callLiteLLM(
    entry: ModelCatalogEntry,
    messages: { role: string; content: string }[],
    req: ModelRequest,
  ): Promise<OpenAIChatResponse> {
    const res = await fetch(`${this.cfg.litellmBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.litellmMasterKey}`,
      },
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
      throw new HttpErr(res.status, `${res.status} ${await res.text().catch(() => res.statusText)}`);
    }
    return (await res.json()) as OpenAIChatResponse;
  }

  private async record(
    req: ModelRequest,
    res: ModelResponse,
    redactedSpans: number,
    _r2: number,
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
    return this.ledger.find({
      where: { tenantId, runId },
      order: { createdAt: "ASC" },
    });
  }
}

class HttpErr extends Error {
  constructor(public status: number, message: string) {
    super(message);
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
