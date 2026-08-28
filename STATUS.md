# Build status

**Phase 1 (Foundations) — scaffold in place and verified end-to-end.** Ref: [`prd/phases/phase-1-architecture.md`](./prd/phases/phase-1-architecture.md).

## Verified on this machine (2026-08-28)

| Check | Result |
|-------|--------|
| `npm install` (workspaces) | ✅ 766 pkgs |
| `npm run build` (contracts → event-schemas → core → orchestrator) | ✅ all compile |
| `npm test` (core: rbac matrix, run state machine) | ✅ 10/10 |
| `docker compose config` | ✅ valid |
| Postgres up + `migration:run` | ✅ `Init1724900000000` applied |
| `seed` | ✅ tenant `acme`, admin `admin@praxis.local`, project `demo-app`, work item `demo-001` |
| `core` boots, `/healthz` + `/readyz` | ✅ |
| Auth: `POST /runs` without token | ✅ 401 Problem-Details |
| **M1 flow**: login → list work-items → `POST /runs` → poll | ✅ `queued→planning→executing→verifying→reviewing→delivering→succeeded`, totals `$0.127 / 38.7k tok`, PR ref set, **47 typed events** in `run_event` |
| **Real-time**: `GET /streams/runs/:id` (SSE) | ✅ live events streamed via Redis Streams bus during a run |

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
                          InprocRunDriver (DEMO advancer for M1 — replaced by orchestrator in P2)
services/orchestrator/     Temporal RunWorkflow (deterministic step sequence, HITL signal gates,
  (skeleton, TS)           pause/resume/cancel) + activities + worker + client helper.
                          Not started by default (RUN_DRIVER=inproc). Wire in Phase 2.
services/agent/            FastAPI skeleton: /healthz + /v1/{triage,repo-map,plan,execute-step,
  (skeleton, Python)       review} with heuristic stubs + pytest. Real LangGraph roles = Phase 3.
services/dashboard/        Static demo console (vanilla JS): login, work items, runs table,
                          live SSE activity feed, pause/resume/cancel/comment. Angular 21 app = Phase 3.
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

- **Orchestrator not wired** — `RUN_DRIVER=inproc` runs a demo advancer inside core. Phase 2 swaps in the Temporal `RunWorkflow` (`RUN_DRIVER=temporal` + run `@praxis/orchestrator`).
- **WebSocket control channel** — pause/resume/comment currently go over REST; WS `/v1/control` is Phase 2.
- **Sandbox** — `SandboxProvider` is interface-only; Firecracker/gVisor/docker backends + broker = Phase 1 P1-SBX-1 / Phase 2 P2-CORE-3.
- **Model Router** — interface defined; LiteLLM container runs; the router service (budgets/attribution/redaction/ledger) = Phase 2 P1-PROV-1.
- **Approvals** — entity + events + state machine exist; the HITL gate service + inbox = Phase 2 P2-CORE-4.
- **Connectors** (GitHub / EDAP Workdesk / Slack) — contracts defined; implementations = Phase 2.
- **Dashboard** — static console only; the Angular 21 app per `prd/12` = Phase 3.
- **Toolchain** — pinned below PRD targets (Node 20 / Python 3.10 / npm), see ADR-0011.
- **Local ports** — Postgres on host **5433** (native PG holds 5432 on this machine).
```
