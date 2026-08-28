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
                          endpoint w/ mandatory-note-to-reject, plan + delivery gates wired into
                          the driver, SLA timer, RBAC-gated decisions) ·
                          InprocRunDriver (DEMO advancer for M1, real approval gates — the
                          *advancement* is replaced by the orchestrator in P2, the gates are not)
services/orchestrator/     Temporal RunWorkflow (deterministic step sequence, HITL signal gates,
  (skeleton, TS)           pause/resume/cancel) + activities + worker + client helper.
                          Not started by default (RUN_DRIVER=inproc). Wire in Phase 2.
services/agent/            FastAPI skeleton: /healthz + /v1/{triage,repo-map,plan,execute-step,
  (skeleton, Python)       review} with heuristic stubs + pytest. Real LangGraph roles = Phase 3.
services/dashboard/        Static demo console (vanilla JS): login, work items, runs table,
                          live SSE activity feed, pause/resume/cancel/comment, **Approvals panel**
                          (polls + SSE-triggered refresh, Approve/Reject with note). Angular 21
                          app = Phase 3.
docker-compose.yml         postgres · postgres-temporal · redis · temporal(+ui) · minio(+setup) ·
                          litellm · otel-collector · core · migrate · agent · orchestrator(profile) ·
                          dashboard · gitea(profile: demo)
infra/                     litellm/config.yaml (stub model, no keys needed) · otel/config.yaml
docs/adr/                  0001–0011
```

## Run it

```bash
cp .env.example .env
docker compose up -d postgres redis
npm install
npm run build:contracts
npm run -w @praxis/core migration:run
npm run -w @praxis/core seed
npm run -w @praxis/core start:dev        # :3000/api/v1  (OpenAPI at /api/v1/docs)
# then, full stack:  docker compose up -d --build   (dashboard on :8080)
```

Login: `admin@praxis.local` / `ChangeMe123!`.

## Known gaps / next (Phase 2 — [`prd/phases/phase-2-foundation.md`](./prd/phases/phase-2-foundation.md))

- **Orchestrator not wired** — `RUN_DRIVER=inproc` runs a demo advancer inside core. Phase 2 swaps in the Temporal `RunWorkflow` (`RUN_DRIVER=temporal` + run `@praxis/orchestrator`) as the thing that *advances* a Run; the Approval gates built this session are driver-agnostic (raise via `ApprovalGateService.create()`, resume via signal instead of the in-memory waiter) so they carry over unchanged.
- **WebSocket control channel** — pause/resume/comment currently go over REST; WS `/v1/control` is Phase 2.
- **Sandbox** — `SandboxProvider` is interface-only; Firecracker/gVisor/docker backends + broker = Phase 1 P1-SBX-1 / Phase 2 P2-CORE-3.
- **Model Router** — interface defined; LiteLLM container runs with a stub model; the router service (budgets/attribution/redaction/ledger) = Phase 2 P1-PROV-1.
- **Risky-tool + review-block + non-progress approval gates** — plan and delivery gates are wired; the other three gate types from prd/06 §5 use the same `ApprovalGateService` but aren't triggered by anything yet (no real tool execution or reviewer exists to trigger them).
- **Connectors** (GitHub / EDAP Workdesk / Slack) — contracts defined; implementations = Phase 2. (Slack would also replace the dashboard-only approval decision path with ChatOps per `prd/09` §3.)
- **Dashboard** — static console only; the Angular 21 app per `prd/12` = Phase 3.
- **Toolchain** — pinned below PRD targets (Node 20 / Python 3.10 / npm), see ADR-0011.
- **Local ports** — Postgres on host **5433** (native PG holds 5432 on this machine).
