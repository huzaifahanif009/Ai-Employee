# Phase 1 — Architecture & Foundations

**Goal:** the skeleton every later phase builds on — repo/monorepo, contracts frozen at v0, CI/CD, local Compose stack, auth/tenancy, and the event pipeline plumbed end to end (even if it carries only synthetic events). Milestone **M1**.

**Exit criteria:** `docker compose up` yields a healthy platform; a user can register a Tenant, log in, create a Project (config only), and a hand-driven Run row streams one real event to the browser over SSE. All interface packages exist with contract-test suites (impls may be stubs).

---

## Monorepo & tooling

### P1-INFRA-1 — Monorepo skeleton
- Deps: P0-INFRA-1. 
- Layout: `packages/` (contracts, schemas, sdk-ts, sdk-py), `services/` (core, orchestrator, agent, sandbox-broker, sandbox-runner, dashboard), `spikes/`, `charts/`, `test/fixtures/`, `docs/adr/`.
- pnpm workspaces (TS) + uv (Python); shared lint/format (eslint+prettier, ruff+black), commitlint, conventional commits.
- **AC:** one command installs all; `make dev` boots the Compose-lite stack; pre-commit hooks run.
- **Testing:** CI job proves clean install + build on a fresh checkout.
- **DoD:** README "contributing" documents the layout.

### P1-INFRA-2 — CI/CD pipeline v1
- Deps: P1-INFRA-1.
- Stages: lint+typecheck → unit → contract (cassettes) → build images (multi-arch) → Trivy scan → SBOM → cosign sign → compose-lite integration smoke → migration up/down/up.
- CD: merge to `main` deploys to a `dev` environment (Argo CD or a compose host).
- **AC:** green pipeline < 15 min; images published by digest; a failing unit test blocks merge.
- **DoD:** [../16-infrastructure-docker.md](../16-infrastructure-docker.md) §6 reflects reality.

### P1-INFRA-3 — Local Compose stack (full)
- Deps: P1-INFRA-1.
- All infra containers ([../16-infrastructure-docker.md](../16-infrastructure-docker.md) §3) + `praxis/*` services + `stub-tracker` + `gitea`. Sandbox backend auto-detect. Single `.env` with fail-fast validation.
- **AC (US-6.1 partial):** `docker compose --profile demo up` → dashboard + all `/readyz` green in < 5 min on a dev laptop; missing required env prints a clear list and exits non-zero.
- **Testing:** CI runs the stack and hits every `/readyz`.
- **DoD:** `.env.example` complete; troubleshooting section in docs.

## Contracts (frozen v0 + contract-test suites)

### P1-CORE-1 — Interface packages
- Deps: P0 findings.
- Publish `@praxis/contracts` (TS) + `praxis_contracts` (Py): `ModelProvider`/`ModelRouter`, `SandboxProvider`, `VcsProvider`, `TrackerProvider`, `ChatOpsProvider`, `SecretsProvider`, `EventBus`, `VectorStore`, `ToolDefinition`/`ToolBroker`, `AgentRuntime` (proto).
- Each ships a **contract test suite** (runnable against any impl) and a **no-op/stub impl**.
- **AC:** every interface has ≥ 1 stub passing its own suite; semver v0.1.0 tagged; changelog started.
- **DoD:** interfaces reviewed by all streams; [../04-technology-research.md](../04-technology-research.md) decision table cross-links the package names.

### P1-CORE-2 — Event schema & envelope
- Deps: P1-CORE-1, P0-FE-1.
- JSON Schema for the [../11-event-architecture.md](../11-event-architecture.md) catalog; codegen TS + Py types; `schemaVersion`; `seq` semantics; the transactional **outbox** pattern spec.
- **AC:** invalid event fails validation in dev; forward-compat (unknown type ignored) tested.
- **DoD:** catalog doc and code agree; a lint checks new event types are registered.

## Platform core

### P1-CORE-3 — Tenancy, identity, RBAC
- Deps: P1-INFRA-3.
- Postgres schema for `tenant`, `user`, `membership`, `service_account`; Argon2id passwords; JWT access + rotating refresh (reuse detection); NestJS capability guard + decorator; RLS policies; repository wrapper injecting `tenant_id` + `SET LOCAL`.
- **AC (US-5.3 partial):** every route declares a capability (a test enumerates + fails on gaps); cross-tenant id → 404; RLS blocks a mis-scoped query in a test.
- **Testing:** RBAC matrix table tests; refresh-reuse revocation test; tenant-isolation integration test.
- **DoD:** [../14-security.md](../14-security.md) §2–3 implemented for local auth (SSO deferred to P4).

### P1-CORE-4 — Projects, Agent configs, Policies (config only)
- Deps: P1-CORE-3.
- CRUD + versioning for `project`, `agent_config`(+versions), `policy`(+versions, presets, platform-maxima clamp). No execution yet.
- **AC (US-1.4 partial):** create a Project referencing a (stub) VCS connector + tracker source + verify pipeline + policy preset; policy edit cannot exceed maxima (tested).
- **DoD:** version diff + rollback endpoints work; audit entries written.

### P1-CORE-5 — Audit log (hash-chained)
- Deps: P1-CORE-3.
- Append-only `audit_log`, monthly partitions, `hash = H(prev_hash || canonical(row))`; write helper used by all mutating services; daily verifier job; export (JSON/CSV).
- **AC (US-5.2 partial):** config change + login recorded with actor/time/before-after; chain verifier passes; tamper (manual row edit) is detected in a test.
- **DoD:** [../14-security.md](../14-security.md) §8 implemented.

### P1-CORE-6 — Event pipeline plumbed
- Deps: P1-CORE-2, P0-FE-1.
- `EventBus` `redis-streams` impl; `run_event` table + outbox worker; Realtime Gateway with SSE (`/streams/runs/:id`, `/streams/fleet`) + WS (`/control`) with JWT + per-topic RBAC; backfill from `run_event`.
- **AC:** a manually inserted `run_event` is delivered to a browser SSE client; reconnect backfills by `seq`; WS `subscribe` respects RBAC (denied cross-tenant).
- **Testing:** P0-FE-1 tests promoted; add RBAC-on-subscribe tests.
- **DoD:** [../11-event-architecture.md](../11-event-architecture.md) §5 works for the fleet + one run stream.

## Providers (thin, one impl each)

### P1-PROV-1 — Model Router + LiteLLM (productionized from spike)
- Deps: P0-PROV-1, P1-CORE-1.
- `ModelRouter` service: catalog table + seed, attribution, budget reserve/settle (against `budget` rows), redaction lib (from P0-SEC-1), exact cache (Redis), fallback chains, `model_call` ledger, OTel `gen_ai.*` spans + Langfuse observation.
- **AC (FR-AI-1,5,6,7,8):** all calls go through it; injected 429 → fallback recorded; secret redacted pre-send; cost in ledger; streaming normalized; a call with no attribution is rejected.
- **Testing:** contract suite for the OpenAI + Anthropic adapters (cassettes) + nightly live smoke.
- **DoD:** [../07-ai-provider-abstraction.md](../07-ai-provider-abstraction.md) contract satisfied for 2 providers + 1 self-hosted.

### P1-PROV-2 — GitHub `VcsProvider` + GitHub Issues `TrackerProvider`
- Deps: P0-PROV-2, P1-CORE-1.
- Productionize the P0 spike; add webhook verify+normalize; store creds via `SecretsProvider` (Infisical adapter).
- **AC:** contract suite passes (branch, read-at-ref, ephemeral token scope+TTL, open+update PR no-dup, comment, checks, protected-branch, webhook normalize for issues/PR/comment).
- **DoD:** [../08-git-provider-abstraction.md](../08-git-provider-abstraction.md) §11 tests green.

### P1-SBX-1 — `SandboxProvider`: firecracker + gvisor + docker backends
- Deps: P0-SBX-1/2, P1-CORE-1.
- Sandbox Broker service + runner protocol; warm pool; lease/return/GC; snapshot/restore; per-Run network namespace + egress allowlist proxy; base rootfs built in CI (scanned, signed, digest-pinned).
- **AC (FR-EXEC-1,7):** lease → repo clone → `shell.exec` → stream → snapshot → restore → destroy; egress default-deny + allowlist enforced; metadata endpoint blocked; `docker` backend logs the "not a boundary" warning.
- **Testing:** contract suite; 50-cycle leak test; red-team egress attempts (from P0-SEC-1) contained.
- **DoD:** [../14-security.md](../14-security.md) §5 controls verified for all three backends.

## Orchestration & agent skeleton

### P1-ORCH-1 — Temporal `RunWorkflow` skeleton
- Deps: P0-ORCH-1, P1-CORE-6.
- Workflow with the [../05-system-architecture.md](../05-system-architecture.md) §4 activity sequence as **stubs** that just emit the right events and sleep; signals (`approvalGranted/Rejected`, `cancel`, `pause`, `resume`, `operatorMessage`); SLA + wall-clock timers; resume-after-restart.
- **AC (M1):** start a Run via API → `run.created` → state machine walks `queued→planning→…→succeeded` emitting events the dashboard shows; kill the worker mid-run → resumes.
- **Testing:** chaos kill tests; signal round-trip test; timer expiry → fail-safe.
- **DoD:** [../00-glossary.md](../00-glossary.md) Run states match the implemented machine.

### P1-AGENT-1 — `AgentRuntime` gRPC server (stub graphs)
- Deps: P0-ORCH-1, P1-CORE-1.
- Python service implementing `RunTriage`, `BuildRepoMap`, `RunPlan`, `ExecuteStep`, `RunReview` with minimal LangGraph graphs that return canned/simple results and stream `AgentEvent`s; Postgres checkpointer wired.
- **AC:** orchestrator calls each RPC; streamed `AgentEvent`s are re-published as platform events; checkpoint resume works.
- **DoD:** contract for [../13-api-design.md](../13-api-design.md) §4 gRPC frozen v0.

## Frontend

### P1-FE-1 — Dashboard app shell
- Deps: P1-CORE-3, P1-CORE-6.
- Angular (or React) app: auth, tenant switcher, left nav, theme (light/dark), connection indicator, SSE + WS client libs, shared components stubs (event-stream list, state chip, stat tile).
- **AC:** log in, see empty Overview + Runs screens; the fleet SSE connects and shows "live"; a11y pass on login + nav.
- **DoD:** [../12-dashboard-ui-spec.md](../12-dashboard-ui-spec.md) §1–2 realized as a shell.

## Docs

### P1-DOC-1 — ADRs + contributor + local-setup docs
- **AC:** ADR-001..010 written; `docs/CONTRIBUTING.md`, `docs/local-setup.md`, `.env.example` reference complete.
- **DoD:** a new engineer can go clone → running stack in < 30 min following the doc (validated by someone outside the setup).
