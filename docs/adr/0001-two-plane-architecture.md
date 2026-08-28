# ADR-0001 — Two-plane architecture (control vs execution)

**Status:** Accepted · **Date:** 2026-08-28 · **Refs:** prd/05, prd/14

## Context
Agents run untrusted, model-authored code and arbitrary shell/build/test commands. That capability cannot share a trust boundary with the API, database, orchestrator, or customer credentials.

## Decision
Split the system into two planes:

- **Control plane** — always-on services (API, orchestrator, model router, VCS/tracker services, tool broker, event bus, dashboard, DB). Never executes untrusted code.
- **Execution plane** — sandbox pool + agent workers. Runs agent-directed code. Holds **no** ambient cloud/control-plane credentials. Connects **outbound only** to a broker endpoint and the model router; no inbound exposure.

Cross-plane calls go through a narrow, authenticated broker (gRPC/mTLS). Sandbox egress is default-deny with a per-Project allowlist.

## Consequences
- Extra moving parts (broker, per-run network namespaces, token minting).
- Strong blast-radius containment: a hijacked agent turn is limited to one bounded step's toolset with no secrets in context.
- Enables a VIKTOR-style self-hosted runner later (outbound-only) with no architecture change.
