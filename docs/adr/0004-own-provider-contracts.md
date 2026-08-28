# ADR-0004 — Own VCS / Tracker / ChatOps contracts, not a unified-API SaaS

**Status:** Accepted · **Date:** 2026-08-28 · **Refs:** prd/08, prd/09

## Context
GitHub / GitLab / Bitbucket / generic Git and Jira / Linear / GitHub Issues / EDAP Workdesk must be swappable. Unified-API SaaS (Nango, Ampersand, Unified.to) exist but add a vendor in the critical path and abstract away PR/branch-protection nuances we depend on.

## Decision
Define first-party interfaces in `@praxis/contracts`: `VcsProvider`, `TrackerProvider`, `ChatOpsProvider` (+ `SandboxProvider`, `SecretsProvider`, `EventBus`, `VectorStore`, `ToolBroker`, `AgentRuntime`). Each ships a **contract-test suite** any implementation must pass; the core imports only the interfaces.

Adapters use best-of-breed native libs (Octokit, @gitbeaker, Bitbucket REST v2, git CLI in the sandbox). Unified-API SaaS may later be offered as an *optional* connector-hosting mode, never required.

## Consequences
- We maintain N adapters (mitigated by the shared contract suite + nightly live smoke).
- Third parties can add out-of-tree connectors by passing the suite.
