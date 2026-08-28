# ADR-0008 — MCP as the interop/extension path; native gRPC tools internally

**Status:** Accepted · **Date:** 2026-08-28 · **Refs:** prd/04 §7, prd/09 §5

## Context
MCP (spec 2026-07-28) is the emerging standard for exposing tools/resources to agents, with OAuth 2.1 hardening and Tier-1 SDKs. We also need internal tools with sub-ms dispatch, compile-time contracts, per-Step allowlisting, and idempotency metadata.

## Decision
- **Internal tools** are native, proto-defined, dispatched via the Tool Broker (`fs.*`, `shell.exec`, `test.run`, `git.*`, `vcs.*`, `tracker.*`, …).
- **MCP client** (P1): mount external MCP servers (stdio + streamable HTTP + OAuth 2.1: PRM discovery RFC 9728, `iss` validation RFC 9207, DCR `application_type`); their tools appear to agents under Policy, default risk tier `approve`, results tagged untrusted.
- **MCP server** (P2): expose a small RBAC-scoped read/act surface (`list_work_items`, `get_run`, `start_run`, …) so external agents/IDEs can drive Praxis.

## Consequences
- Some duplication (native + MCP) — accepted for latency and contract strength internally, interop externally.
