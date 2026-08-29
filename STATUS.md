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

## Verified on this machine (2026-08-29) — Webhook signature verification slice

| Check | Result |
|-------|--------|
| `npm test` (core, 10 suites incl. new `webhook-signature.spec.ts` — 14 cases) | ✅ 63/63 |
| Migration `WebhookSecret1725600000000` (`connector.webhookSecretCiphertext` + `webhookSecretHint`) | ✅ applied |
| `POST /connectors/:id/webhook-secret` (rotate) | ✅ returns plaintext once + `hint` + `family` + `header`; ciphertext never returned |
| GitLab webhook — no secret configured (`WEBHOOK_REQUIRE_SIGNATURE=true`) | ✅ 403 |
| GitLab webhook — wrong / missing `X-Gitlab-Token` | ✅ 401 |
| GitLab webhook — correct token | ✅ 201 `{ok:true}` |
| GitHub webhook — missing / bad `X-Hub-Signature-256` | ✅ 401 |
| GitHub webhook — valid HMAC but tampered body | ✅ 401 (raw-body HMAC, constant-time compare) |
| GitHub webhook — correct HMAC over raw body | ✅ 201 `{ok:true}` |
| `webhookSecret` accepted at connector create; `webhookSecretHint` in list, ciphertext never | ✅ |

## Verified on this machine (2026-08-29) — AI Providers & Models slice

| Check | Result |
|-------|--------|
| `npm test` (core, 9 suites incl. new `scrub-key.spec.ts`) | ✅ 49/49 |
| Migration `AiProviders1725500000000` (`ai_provider` / `ai_provider_key` / `ai_model`) | ✅ applied |
| `GET /ai/provider-kinds` | ✅ `["openai","openai-compatible","azure-openai","anthropic","google"]` |
| `POST /ai/providers` (openai) | ✅ first provider → default, auto-seeds `fast`→gpt-4o-mini + `strong`→gpt-4o |
| `POST /ai/providers/:id/keys` (fake key) | ✅ encrypted at rest, response carries only `last4` + `status:invalid`; **no ciphertext, no raw key** |
| Provider-echoed key in a 401 body | ✅ `scrubKey` strips it before it is stored/returned (`401 … provided: [redacted]…`) |
| Run with no valid key | ✅ Model Router resolves tenant model, key invalid → falls back to `litellm/praxis-stub`, run still `succeeded` |
| `provider:write` capability gates all `/ai` mutations | ✅ |

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
                          **AI Providers & Models** (prd/07 / ADR-0003): DB-backed, per-tenant,
                          dashboard-managed — **no provider keys in env**. `ai_provider` (openai /
                          openai-compatible / azure-openai / anthropic / google, extensible),
                          `ai_provider_key` (multiple per provider, AES-256-GCM ciphertext at
                          rest, enable/disable, per-provider default, `test()` status), `ai_model`
                          (alias → provider model, routing classes, price, per-tenant default).
                          `AiRegistryService`: CRUD + enable/disable + defaults + key testing +
                          model seed/discover + `resolve(tenant, {modelHint|routingClass|purpose})`.
                          Pluggable `ProviderClient` adapters (`test()` + `chat()` normalised to
                          an OpenAI shape). `AiController` at `/ai/*`, all mutations gated by the
                          new `provider:write` capability. **Raw keys + ciphertext never returned
                          or logged**; `scrubKey()` strips provider-echoed key fragments from
                          stored test details. ·
                          **Model Router** (prd/07 / ADR-0003): `ModelRouterService` resolves the
                          tenant's model + key via `AiRegistryService`, calls the provider adapter
                          directly, redacts every active provider secret from prompts, and falls
                          back to the always-on LiteLLM `praxis-stub` when no valid key resolves.
                          Per-call attribution, `model_call` cost ledger + `model_call.*` events
                          (incl. `model_call.fallback`), exact Redis cache, per-Run budget check →
                          soft = budget approval gate, hard = abort. `GET /ai/models` (catalog),
                          `/model/health`, `/runs/:id/model-calls`. ·
                          **Connectors + VCS** (prd/08–09): `connector` table (AES-256-GCM
                          token encryption at rest via common/crypto — interim, `SecretsProvider`
                          later), `ConnectorsService` (CRUD / test / browse repos; API never
                          returns the ciphertext or raw token, only a `••••1234` hint),
                          `GitLabVcsProvider` **and** `GitHubVcsProvider` implement `VcsProvider`
                          (REST v4 / REST v3, self-hosted or SaaS via configurable base URL) —
                          repos, branches, protected branches, read-at-ref, create branch, open/
                          update PR/MR, comments, checks (pipelines / check-runs), hooks +
                          webhook normalize. `resolveVcs()`/`resolveTracker()` switch on kind;
                          Bitbucket + generic-git still to do. **Inbound webhooks are
                          authenticated** (prd/09 §5): per-connector secret encrypted at rest,
                          GitHub `X-Hub-Signature-256` HMAC-SHA256 over the raw body / GitLab
                          `X-Gitlab-Token`, constant-time compare, `POST /connectors/:id/
                          webhook-secret` rotates it (plaintext shown once), `WEBHOOK_REQUIRE_
                          SIGNATURE=true` rejects unverified deliveries (401 / 403 no-secret).
                          `GET/POST/PATCH/DELETE /connectors`, `/connectors/:id/test|repos|webhook-secret`.
                          Project gains `vcsConnectorId` + `repoRef.path`. ·
                          **Tracker + Intake** (prd/09 §2): `GitLabTrackerProvider` — GitLab
                          issues as work items (list/get/normalize w/ acceptance-criteria
                          parsing, comment, close/reopen, poll, webhook normalize). A GitLab
                          connector now serves **both** contracts (`['vcs','tracker']`).
                          `GitLabTrackerProvider` + `GitHubTrackerProvider` (issues → work items).
                          `IntakeService` — `@Cron` poll (once/min) + `POST /projects/:id/intake/
                          sync` + public `POST /webhooks/in/:connectorId` → idempotent
                          `upsertFromDraft`, auto-start runs if `intake.mode=auto`, per-project
                          cursor. On MR open the run comments the source issue with the MR link.
                          On a **PR/MR merged/closed webhook** the run's work item is closed
                          (merged) / rejected, and the source issue is transitioned. Project
                          gains `trackerConnectorId` + `intakeCursor`. ·
                          **Sandbox** (ADR-0005): `SandboxProvider` `docker` backend —
                          `DockerSandboxProvider` shells the docker CLI against a mounted socket,
                          builds its base image on first use, acquire/exec/writeFile/readFile/
                          release, per-run container labelled + torn down. `none` backend for
                          no-docker envs. (firecracker/gvisor = later.) ·
                          **Tool Broker** (prd/09 §4): `ToolBrokerService` — native tools
                          `shell.exec / fs.read|write|list / code.search / test.run / git.*`
                          dispatched into the run's sandbox; `tool_call` ledger + `tool_call.*`
                          events; risk-tier resolution (max of tool default + policy); `fs.write`
                          path guard (no traversal / .git / CI config); `approve` tier → HITL
                          gate; `git.push` = forbidden until a VCS connector exists.
                          `GET /tools/catalog`, `/runs/:id/tool-calls` ·
                          InprocRunDriver (DEMO advancer; now does **real work** — provisions a
                          container; if the project has a bound VCS connector it **clones the
                          real repo, makes a small safe change, pushes the branch and opens a
                          real MR/PR** (token redacted from all logs/events); otherwise it
                          materialises a fixture repo + runs real `node --test`. 6 metered model
                          calls + ~12 real tool calls per run, real commit + unified diff,
                          sandbox torn down. The *advancement* is replaced by the orchestrator in
                          P2; the gates, model calls, tool calls and VCS delivery are not.)
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
                          Run detail tabs: Activity (live), Plan, Changes, Tools, Verification,
                          Review, Delivery, Cost. **Integrations screen** — add/test/delete a
                          GitLab connector (base URL + project path + token, password field),
                          browse its repositories, bind one to the demo project. **AI Providers &
                          Models screen** (`/ai`) — add providers, add/edit/delete/test multiple
                          API keys per provider (write-only password field, masked last-4 + status
                          badge), enable/disable + pick a default key, add/manage models with
                          routing classes + prices + a default. Sidebar nav includes Integrations
                          + AI Providers; the rest of prd/12 stays a greyed "Roadmap".
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
- **Sandbox** — `docker` backend + Tool Broker done for this slice. Follow-ups: Firecracker/gVisor backends (real isolation — the docker backend is explicitly *not* a boundary), egress allowlisting proxy, warm pool, snapshot/restore for pause/resume, per-Run scoped Git credentials (needs a VCS connector), a real repo clone (uses an in-container fixture today).
- **Model Router + AI Providers — done for this slice** (`services/core/src/ai/`, `services/core/src/model/`). DB-backed per-tenant provider/key/model registry with dashboard CRUD, encrypted keys, `provider:write` RBAC, direct provider adapters, stub fallback. Follow-ups: tenant/project *monthly* budget caps (only per-Run enforced now), semantic cache, true token streaming (currently `stream()` chunks a completed response), OTel `gen_ai.*` spans, `/model/usage` aggregation endpoint for analytics, move the encrypted key store behind a real `SecretsProvider` (Infisical), wire the Python LangGraph Coder to drive tools for real once a live key is added.
- **Risky-tool + review-block + non-progress approval gates** — plan / delivery / **budget** gates are wired; the other three gate types from prd/06 §5 use the same `ApprovalGateService` but aren't triggered by anything yet (no real tool execution or reviewer exists to trigger them).
- **Connectors** — **GitLab + GitHub** VCS & issue-tracker providers done; GitLab verified end-to-end against `gitlab.edap.com.pk/huzaifahanif307/calculator` (real MR !2); GitHub verified reaching `api.github.com` (graceful 401 with a fake token). PR/MR merge→close-issue webhook loop done. Follow-ups: Bitbucket + generic-git VcsProviders, EDAP Workdesk / Jira / Linear trackers, Slack ChatOps (would move approval decisions out of the dashboard-only path per `prd/09` §3), per-Run scoped tokens instead of the stored PAT (GitHub App installation tokens / GitLab project access tokens), move the token store behind a real `SecretsProvider` (Infisical), webhook signature verification — **done** (GitHub `X-Hub-Signature-256` HMAC-SHA256 over the raw body + GitLab `X-Gitlab-Token`, constant-time; per-connector encrypted secret, rotate endpoint, `WEBHOOK_REQUIRE_SIGNATURE` flag).
- **Dashboard** — real Next.js app now covers the core loop (login → work items → runs → live run detail → approvals). Integrations + AI Providers & Models screens now built too. Not yet built from prd/12: Projects / Agents & Policies / Analytics / System Health / Audit Log screens (shown as a "Roadmap" section in the sidebar); WebSocket for control actions (uses REST); virtualized lists; a11y audit.
- **Dashboard framework decision** — Next.js (per user direction — separate from the EDAP Workdesk Angular app), not Angular. `prd/04` §15 / `prd/12` §1 name Angular as the default with Next.js an accepted alternative; the alternative was chosen. ADR update pending.
- **Toolchain** — pinned below PRD targets (Node 20 / Python 3.10 / npm), see ADR-0011.
- **Local ports** — Postgres on host **5433** (native PG holds 5432 on this machine).
