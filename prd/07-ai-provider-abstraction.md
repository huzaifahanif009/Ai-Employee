# 07 — AI Provider Abstraction

## 1. Goals

- One egress point for every LLM call (FR-AI-1). No service imports `openai` / `@anthropic-ai/sdk` / `google-genai` directly.
- Add a provider (or a self-hosted endpoint) **without touching core code** — a new adapter + catalog entry.
- Normalized **streaming**, **tool/function calling**, and **multimodal** across providers.
- **Failover & retry** across providers/models on transient errors.
- **Cost & token metering** attributed to Run / Step / Agent / Project / Tenant.
- **Redaction** and **data-handling controls** (no-train, retention) per provider.
- Optional **caching** (exact + semantic) and prompt-cache hints.
- A **model catalog** with capabilities so routing can be automatic.

## 2. Layering

```
callers:  Agent Worker (LangGraph) · Triage · summarizers · dashboard "explain" · connectors
              │  ModelRequest (normalized)
              ▼
        ┌───────────────────────────────────────────────┐
        │  Model Router  (first-party, TS/NestJS)        │
        │  · resolve model binding (agent/role/tenant)   │
        │  · budget check + reserve (Run/Project/Tenant) │
        │  · attribution tags (run_id, step_id, agent)   │
        │  · redaction (prompt-injection aware)          │
        │  · cache lookup (exact / semantic)             │
        │  · pick route + fallback chain from catalog    │
        │  · cost ledger write (post-call)              │
        └───────────────┬───────────────────────────────┘
                        ▼  OpenAI-compatible call (+ our headers/metadata)
        ┌───────────────────────────────────────────────┐
        │  LiteLLM proxy (self-hosted)                   │
        │  · provider adapters · key mgmt · rate limits  │
        │  · provider-level fallbacks · load balancing   │
        └───────────────┬───────────────────────────────┘
                        ▼
   OpenAI · Anthropic · Google Gemini · Azure OpenAI · Bedrock · Vertex ·
   self-hosted OpenAI-compatible (vLLM / Ollama / TGI) · code-specialized models
```

**Why two layers:** LiteLLM already solves provider fan-out, key management, and provider-level fallback well and is self-hostable/air-gappable. The Model Router owns the concerns that are *ours*: budgets, per-Run attribution, our redaction rules, our cost ledger, our routing catalog, and our caching policy. If we later replace LiteLLM (with Portkey, or direct adapters), only the Router's downstream call changes.

## 3. Normalized request/response contract

```ts
interface ModelRequest {
  // routing
  purpose: 'triage' | 'plan' | 'code' | 'review' | 'research' | 'summarize' | 'embed';
  modelHint?: string;          // explicit model id/alias; else resolved from binding
  routingClass?: 'fast' | 'balanced' | 'strong' | 'code' | 'long-context';
  // payload
  messages: Message[];         // system/user/assistant/tool; content parts: text|image|file
  tools?: ToolSchema[];        // JSON-schema function defs (provider-normalized)
  toolChoice?: 'auto' | 'none' | { name: string };
  responseFormat?: 'text' | 'json' | { jsonSchema: object };
  maxOutputTokens?: number;
  temperature?: number;
  stream?: boolean;
  // governance
  attribution: { tenantId: string; projectId: string; runId?: string; stepId?: string; agentRole?: string };
  dataPolicy?: { noTrain?: boolean; retention?: 'none' | 'provider-default' | string };
  cache?: { mode: 'off' | 'exact' | 'semantic'; ttlSeconds?: number };
  budgetPolicy?: { onSoftLimit: 'raiseApproval' | 'continue'; };
  timeoutMs?: number;
}

interface ModelResponse {
  model: string; provider: string;
  content: ContentPart[];             // normalized text/parts
  toolCalls?: { id: string; name: string; arguments: object }[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number;
           costUsd: number; };
  routing: { attempts: RouteAttempt[]; cacheHit?: 'exact' | 'semantic' | null };
  latencyMs: number;
  raw?: unknown;                      // provider raw, redacted, optional
}
```

Streaming yields normalized events (also re-emitted onto the platform event bus for the dashboard):
`message.delta` (text), `tool_call.delta` (partial args), `tool_call.done`, `usage`, `done`, `error`.

## 4. Provider adapter contract

Most providers are reached **through LiteLLM** (config entry only). A **native `ProviderAdapter`** is implemented only when a provider has capabilities LiteLLM doesn't expose the way we need (e.g. Anthropic prompt-cache breakpoints, extended thinking, provider-specific safety headers).

```ts
interface ProviderAdapter {
  id: string;                                   // 'anthropic' | 'openai' | 'gemini' | 'vllm' | ...
  listModels(): Promise<ModelCatalogEntry[]>;   // may be static config
  supports(feature: ProviderFeature): boolean;  // 'tools'|'json_schema'|'vision'|'files'|'streaming'|'prompt_cache'|'thinking'
  toProviderRequest(req: ModelRequest): unknown;
  fromProviderResponse(raw: unknown): ModelResponse;
  streamAdapter(raw: AsyncIterable<unknown>): AsyncIterable<NormalizedStreamEvent>;
  estimateCost(usage, model): number;           // from catalog price table
  healthCheck(): Promise<HealthStatus>;
}
```

Contract test suite (runs in CI against a recorded-cassette + optional live smoke): tool-call round-trip, JSON-schema output, streaming assembly, usage/cost parsing, timeout behavior, error mapping.

## 5. Model catalog & routing

`model_catalog` (seeded + editable per Tenant):

| Field | Example |
|-------|---------|
| `alias` | `strong-code`, `fast-cheap`, `long-context` |
| `provider` / `model` | `anthropic` / `claude-sonnet-4.x` |
| `context_window` | 200000 |
| `max_output` | 64000 |
| `capabilities` | `[tools, json_schema, vision, prompt_cache, thinking]` |
| `price_input` / `price_output` / `price_cached_input` | per-MTok |
| `latency_class` | `fast` / `medium` / `slow` |
| `data_region` | `us` / `eu` / `self` |
| `enabled` | bool |
| `weight` | for load-balancing within a class |

**Resolution order for a call:** explicit `modelHint` → Agent's `model_binding` for that role → Project role default → Tenant role default → `routingClass` → platform default alias.

**Fallback chain:** each alias/binding has an ordered `fallbacks: [alias]`. On `429 / 5xx / timeout / content_filter(retryable) / provider_unavailable`, the Router advances the chain (max attempts configurable, jittered backoff). Non-retryable (400 bad request, auth) fail fast with a clear error. All attempts recorded in `ModelResponse.routing.attempts` and as events.

**Auto-routing (P1):** given `routingClass` + required capabilities + `data_region` + budget headroom, the Router picks the cheapest catalog entry that satisfies constraints, honoring per-Tenant preference weights.

## 6. "Codex" / code-specialized & self-hosted models

- Code-optimized hosted models are ordinary catalog entries (`routingClass: code`). Agents request `routingClass:'code'` for Coder; the binding resolves to whatever the Tenant configured.
- **Self-hosted**: the Tenant registers an OpenAI-compatible base URL + key (vLLM/Ollama/TGI). It becomes a provider in LiteLLM and a catalog entry with `data_region: self`. Air-gapped deployments use *only* `data_region: self` entries; the Router refuses to route outside the allowed regions when Tenant policy says so.

## 7. Cost & token metering

- Every completed call writes a `model_call` ledger row: `tenant_id, project_id, run_id, step_id, agent_role, provider, model, input_tokens, output_tokens, cached_input_tokens, cost_usd, latency_ms, cache_hit, attempts, ts`.
- Cost = catalog price × tokens (cached-input priced separately). If a provider returns authoritative cost, prefer it and record the delta.
- Aggregations (materialized, refreshed ≤ 1 min): per Run, per Project/day, per model/day, per Tenant/month, per outcome (successful vs failed Run spend).
- Budgets ([10](./10-database-architecture.md) `budgets`): Router **reserves** an estimated cost before a call and **settles** after. Reservation prevents overshoot from many parallel calls. Soft-limit → raise Approval (per `budgetPolicy`); hard-limit → the Router returns `budget_exceeded` and the Orchestrator aborts.

## 8. Redaction & data governance

- **Outbound redaction** before a prompt leaves the Router: strip known secret patterns (high-entropy strings, key formats), Tenant-configured regexes, and any value present in the Tenant secret store. Redaction happens *after* the agent assembled context but *before* the provider call; the stored trace keeps the redacted form.
- **Untrusted-content tagging:** tool outputs (web pages, ticket bodies, file contents from untrusted sources) are wrapped in explicit delimiters and marked so the model treats them as data, not instructions (prompt-injection mitigation; see [14](./14-security.md)).
- **Provider data policy:** per provider, set `noTrain` and retention headers/opt-outs where supported; block providers that can't honor a Tenant's required policy (Router refuses to route to them, logs why).
- **Region pinning:** `data_region` on catalog entries + Tenant allowed regions; Router enforces.
- **PII:** optional PII scrubber (presidio-style) on inbound ticket text and outbound prompts, configurable per Tenant.

## 9. Caching

| Mode | Key | Use |
|------|-----|-----|
| `exact` | hash of (model, normalized messages, tools, params) | idempotent summarization, repeated triage of unchanged text |
| `semantic` | embedding of the salient prompt + similarity threshold | "explain this diff", research lookups |
| prompt-cache hints | pass provider prompt-cache breakpoints for stable prefixes (system+repo map) | cut input cost on long agent loops |

Cache is **opt-in per call** (`cache.mode`); Coder action turns default to `off` (non-determinism desired), Planner repo-analysis and summaries default to `exact`. Cache store: Redis (small/exact) + pgvector (semantic). Hits recorded in the ledger with `cost_usd = 0` and `cache_hit`.

## 10. Reliability

- Timeouts on every call (`timeoutMs`, default per routing class).
- Circuit breaker per (provider, model): after N consecutive failures, mark route unhealthy for a cooldown; catalog `healthCheck` and live error rates feed the breaker.
- If **all** routes for a required class are unhealthy → Router returns `provider_unavailable`; the Orchestrator **pauses** affected Runs (NFR-REL-4) and auto-resumes when a route recovers.
- Idempotency: a `Model-Request-Id` header lets retried activities dedupe identical calls (returns the prior response if within a short window).

## 11. Config surface

Per Tenant: providers + credentials (in secrets manager), model catalog overrides, role defaults, fallback chains, allowed data regions, data-policy requirements, cache defaults, monthly budget.
Per Project: role model bindings, per-Run budgets, cache overrides, region restriction.
Per Agent: explicit model binding per role, temperature/format, tool-choice policy.

## 12. Observability hooks

- Each call is an OTel `gen_ai.*` span (model, provider, tokens, cost, latency, finish reason, attempt count) **and** a Langfuse observation nested under the Run/Step trace.
- Metrics: `model_calls_total{provider,model,outcome}`, `model_tokens_total{...}`, `model_cost_usd_total{...}`, `model_latency_seconds`, `model_route_fallbacks_total`, `model_cache_hits_total{mode}`, `model_circuit_open{provider,model}`.
- Dashboard "AI usage" screens read the ledger aggregations; every cost figure shows provider + model (FR-DASH-12).
