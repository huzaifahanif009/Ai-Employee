# ADR-0003 — All model calls via Model Router → LiteLLM

**Status:** Accepted · **Date:** 2026-08-28 · **Refs:** prd/07

## Context
Need OpenAI + Anthropic + Gemini + Codex-class + self-hosted OpenAI-compatible endpoints, with normalized streaming & tool-calling, failover/retry, per-Run cost metering, redaction, region pinning, optional caching — and it must be self-hostable / air-gap capable.

## Decision
Two thin layers:

1. **`ModelRouter`** (first-party, in `@praxis/core`) — resolves the model binding, reserves/settles budget, stamps Run/Step attribution, runs redaction (secrets + PII + untrusted-content tagging), checks the response cache, picks the route + fallback chain from a catalog, writes the `model_call` cost ledger, emits `gen_ai.*` spans + Langfuse observations.
2. **LiteLLM** (self-hosted proxy) — provider adapters, key management, provider-level fallback, load balancing.

**No service imports a provider SDK directly.** "Codex" / code models are ordinary catalog entries (`routingClass: code`).

## Alternatives rejected
Portkey (SaaS-leaning), OpenRouter / Vercel AI Gateway (hosted-only, conflicts with air-gap), per-provider SDKs (reimplements routing/metering/redaction N times). See prd/04 §5.

## Consequences
- LiteLLM is one more service to operate.
- Swapping the fan-out layer later touches only `ModelRouter`'s downstream call.
