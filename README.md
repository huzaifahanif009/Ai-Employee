# Praxis — AI Execution Platform

AI agents that take a ticket → plan → branch → implement → test → open a PR/MR for **manual human merge**.
Provider-agnostic (AI, Git host, task tracker), durable, sandboxed, observable.

Full product & architecture spec: **[`prd/`](./prd/)** — start at [`prd/README.md`](./prd/README.md).

---

## Repository layout

```
prd/                      Product Requirements — the source of truth for design
docs/adr/                 Architecture Decision Records
packages/
  contracts/              @praxis/contracts — provider/connector/tool/agent interfaces (no impls)
  event-schemas/          @praxis/event-schemas — event envelope + catalog (JSON Schema + TS types)
services/
  core/                   @praxis/core — NestJS control-plane API (auth, tenancy, projects, work-items, runs, events, SSE/WS)
  orchestrator/           @praxis/orchestrator — Temporal worker: RunWorkflow + activities
  agent/                  praxis-agent — Python agent runtime (LangGraph graphs, gRPC/HTTP server) [skeleton]
  dashboard/              @praxis/dashboard — operator console [skeleton]
docker-compose.yml        full local stack
Makefile                  common tasks
.env.example              all config, copy to .env
```

## Status

Phase 1 (Foundations) scaffold — see [`prd/phases/phase-1-architecture.md`](./prd/phases/phase-1-architecture.md).
Implemented so far:

- [x] Monorepo tooling (npm workspaces; pnpm is the documented target — see ADR-0011)
- [x] `@praxis/contracts` — interface packages + stubs
- [x] `@praxis/event-schemas` — envelope + catalog types
- [x] `@praxis/core` — config, health, auth (JWT), tenancy + RBAC guard, projects, work-items, runs state machine, EventBus (in-memory + Redis Streams), SSE stream endpoint
- [x] `@praxis/orchestrator` — Temporal `RunWorkflow` skeleton + stub activities + signals
- [x] `praxis-agent` — Python HTTP skeleton with stub `triage` / `plan` / `execute_step` / `review`
- [x] `docker-compose.yml` — postgres, redis, temporal(+ui), minio, litellm, otel-collector, core, orchestrator, agent
- [ ] Dashboard app (placeholder)
- [ ] Sandbox broker / runner (Phase 2)

## Quick start

```bash
cp .env.example .env
make up            # docker compose up -d  (postgres, redis, temporal, minio, litellm, core, orchestrator, agent)
make migrate       # run DB migrations + seed a demo tenant/project
make health        # curl the /healthz of every service
open http://localhost:3000/api/v1/docs        # OpenAPI
```

Local dev without Docker for the app services:

```bash
npm install
npm run -w @praxis/contracts build
npm run -w @praxis/event-schemas build
docker compose up -d postgres redis        # infra only
npm run -w @praxis/core start:dev
```

## Toolchain on this machine

Node 20, npm workspaces, Python 3.10, Docker 29. The PRD targets Node 22 + pnpm 10 + Python 3.12; the scaffold is pinned lower to run as-is here and documented in ADR-0011.
