# Build status

**Phase 1 (Foundations) — scaffold in place and verified end-to-end.** Ref: [`prd/phases/phase-1-architecture.md`](./prd/phases/phase-1-architecture.md).

## Verified on this machine (2026-08-28)

| Check | Result |
|-------|--------|
| `npm install` (workspaces) | ✅ 766 pkgs |
| `npm run build` (contracts → event-schemas → core → orchestrator) | ✅ all compile |
| `npm test` (core: rbac matrix, run state machine, approval rules) | ✅ 15/15 |
| `docker compose config` | ✅ valid |
| Full stack (`docker compose up -d --build`) | ✅ all 11 containers healthy |
| Postgres up + `migration:run` | ✅ `Init1724900000000` applied |
| `seed` | ✅ tenant `acme`, admin `admin@praxis.local`, project `demo-app`, work item `demo-001` |
| `core` boots, `/healthz` + `/readyz` | ✅ |
| Auth: `POST /runs` without token | ✅ 401 Problem-Details |
| **M1 flow**: login → list work-items → `POST /runs` → poll | ✅ full state machine to `succeeded`, totals `$0.127 / 38.7k tok`, PR ref set, 47 typed events in `run_event` |
| **Real-time**: `GET /streams/runs/:id` (SSE), through the dashboard's nginx proxy too | ✅ live events streamed via Redis Streams bus during a run |
| **HITL / Approvals** (new): plan-approval gate blocks a Run, `reject` with no note → 400, `approve` resumes the run to `succeeded`, `reject` (with note) fails it as `plan_rejected` with the note surfaced as the failure message | ✅ all four paths verified live via the API |
| Dashboard (`:8080`) served through nginx, proxies `/api/*` including SSE | ✅ 200, login round-trips to core |

## What exists

```
packages/contracts/       VcsProvider · TrackerProvider · ChatOpsProvider · SandboxProvider ·
                          SecretsProvider · EventBus · ModelRouter/ProviderAdapter · ToolBroker ·
                          AgentRuntime · PraxisError            (interfaces only — ADR-0004/0009)
packages/event-schemas/   EventEnvelope · 50-type catalog · run state machine + transitions ·
                          typed payloads · envelope JSON Schema
services/core/  (NestJS)   config (Joi-validated, fail-fast) · health · auth (JWT access+refresh,
                          argon2) · RBAC guard + capability matrix + request context ·
                          Problem-Details filter (RFC 9457) · TypeORM entities + init migration +
                          seed · Projects · WorkItems · Runs (state machine, list/get/start/
                          pause/resume/cancel/comment) · EventBus (memory + redis-streams) ·
                          RunEventsService (append w/ advisory-lock seq + outbox publish) ·
                          SSE endpoints (/streams/runs/:id + /streams/fleet, Last-Event-ID backfill) ·
                          Approvals (real HITL: ApprovalGateService raise/wait/notify, decide
                          endpoint w/ mandatory-note-to-reject, plan + delivery + budget gates,
                          SLA timer, RBAC-gated decisions) ·
                          **Model Router** (prd/07 / ADR-0003): `ModelRouterService` → LiteLLM
                          (OpenAI-compatible), static provider catalog (stub always-on; openai/
                          anthropic/google activate when the key is set), per-call attribution,
                          `model_call` cost ledger + `model_call.*` events, pattern-based
                          redaction, exact Redis cache, provider fallback chain, per-Run budget
                          check → soft = budget approval gate, hard = abort. `GET /model/catalog`,
                          `/model/health`, `/runs/:id/model-calls`. ·
                          InprocRunDriver (DEMO advancer for M1; now makes 6 real metered model
                          calls per run — triage/plan/code×3/review — the *advancement* is
                          replaced by the orchestrator in P2, the gates + model calls are not)
services/orchestrator/     Temporal RunWorkflow (deterministic step sequence, HITL signal gates,
  (skeleton, TS)           pause/resume/cancel) + activities + worker + client helper.
                          Not started by default (RUN_DRIVER=inproc). Wire in Phase 2.
services/agent/            FastAPI skeleton: /healthz + /v1/{triage,repo-map,plan,execute-step,
  (skeleton, Python)       review} with heuristic stubs + pytest. Real LangGraph roles = Phase 3.
services/dashboard/        **Next.js 16 + React 19 + Tailwind v4 + Radix (shadcn-style)** app.
  (@praxis/dashboard)      TanStack Query for data, native EventSource for SSE, dark-first theme
                          (light/dark/system toggle). Imports the real `@praxis/event-schemas`
                          catalog (single source of truth for event types / run states).
                          Screens: Login (+ register), Overview (fleet stat tiles, active agents,
                          open approvals, recent runs), Runs list, Run detail (live Activity feed
                          folded from the event stream + Plan / Verification / Review / Delivery
                          tabs derived from events, pause/resume/cancel/comment, inline approval
                          card), Approvals inbox, Work Items (list + create dialog + start run).
                          Run detail has a **Cost** tab (per-model call table from the ledger:
                          purpose/role/model/in/out tokens/cost/latency/cache/redactions).
                          Sidebar shows the fuller prd/12 IA as a greyed "Roadmap" section.
docker-compose.yml         postgres · postgres-temporal · redis · temporal(+ui) · minio(+setup) ·
                          litellm · otel-collector · core · migrate · agent · orchestrator(profile) ·
                          dashboard · gitea(profile: demo)
infra/                     litellm/config.yaml (stub model, no keys needed) · otel/config.yaml
docs/adr/                  0001–0011
```

## Run it

Full stack in Docker (recommended):

```bash
cp .env.example .env
docker compose up -d --build          # core :3000 · dashboard :8080 · temporal-ui :8088
docker compose run --rm migrate       # migrations + demo seed (first run only)
open http://localhost:8080            # login: admin@praxis.local / ChangeMe123!
```

App services only, against Dockerised infra (faster inner loop):

```bash
docker compose up -d postgres redis
npm install && npm run build:contracts
npm run -w @praxis/core migration:run && npm run -w @praxis/core seed
npm run -w @praxis/core start:dev      # :3000/api/v1  (OpenAPI at /api/v1/docs)
npm run -w @praxis/dashboard dev       # :3000 by default — set PORT=3001; browser talks to core directly
```

## Known gaps / next (Phase 2 — [`prd/phases/phase-2-foundation.md`](./prd/phases/phase-2-foundation.md))

- **Orchestrator not wired** — `RUN_DRIVER=inproc` runs a demo advancer inside core. Phase 2 swaps in the Temporal `RunWorkflow` (`RUN_DRIVER=temporal` + run `@praxis/orchestrator`) as the thing that *advances* a Run; the Approval gates built this session are driver-agnostic (raise via `ApprovalGateService.create()`, resume via signal instead of the in-memory waiter) so they carry over unchanged.
- **WebSocket control channel** — pause/resume/comment currently go over REST; WS `/v1/control` is Phase 2.
- **Sandbox** — `SandboxProvider` is interface-only; Firecracker/gVisor/docker backends + broker = Phase 1 P1-SBX-1 / Phase 2 P2-CORE-3.
- **Model Router — done for this slice** (`services/core/src/model/`). Follow-ups: DB-backed catalog with per-tenant overrides, tenant/project *monthly* budget caps (only per-Run enforced now), semantic cache, true token streaming (currently `stream()` chunks a completed response), OTel `gen_ai.*` spans, `/model/usage` aggregation endpoint for analytics.
- **Risky-tool + review-block + non-progress approval gates** — plan / delivery / **budget** gates are wired; the other three gate types from prd/06 §5 use the same `ApprovalGateService` but aren't triggered by anything yet (no real tool execution or reviewer exists to trigger them).
- **Connectors** (GitHub / EDAP Workdesk / Slack) — contracts defined; implementations = Phase 2. (Slack would also replace the dashboard-only approval decision path with ChatOps per `prd/09` §3.)
- **Dashboard** — real Next.js app now covers the core loop (login → work items → runs → live run detail → approvals). Not yet built from prd/12: Projects / Agents & Policies / Analytics / Integrations / System Health / Audit Log screens (shown as a "Roadmap" section in the sidebar); WebSocket for control actions (uses REST); virtualized lists; a11y audit.
- **Dashboard framework decision** — Next.js (per user direction — separate from the EDAP Workdesk Angular app), not Angular. `prd/04` §15 / `prd/12` §1 name Angular as the default with Next.js an accepted alternative; the alternative was chosen. ADR update pending.
- **Toolchain** — pinned below PRD targets (Node 20 / Python 3.10 / npm), see ADR-0011.
- **Local ports** — Postgres on host **5433** (native PG holds 5432 on this machine).
