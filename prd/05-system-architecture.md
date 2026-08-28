# 05 — System Architecture

## 1. Architectural style

- **Modular monolith control plane + separate execution plane.** The control plane is a small set of cooperating services (some could be one deployable early, split later). The execution plane (sandboxes + agent workers) is physically and network-isolated.
- **Contract-first.** Every provider/connector/tool is a versioned interface package with contract tests. The core imports interfaces, never concrete providers.
- **Event-sourced timeline.** Every Run's history is an append-only sequence of typed events in Postgres; the live bus is a projection for real-time UI.
- **Durable orchestration.** Temporal owns Run lifecycle; nothing important lives only in memory or an HTTP request.
- **Two-plane security boundary.** Control plane never runs untrusted code; execution plane never holds ambient credentials or a route to control-plane internals.

## 2. Component overview

```
                                   ┌──────────────────────────── CLIENTS ────────────────────────────┐
                                   │  Dashboard (Angular)   CLI / SDK   ChatOps (Slack)   MCP clients │
                                   └───────────────┬───────────────┬───────────────┬─────────────────┘
                                                   │ REST/SSE/WS   │ REST          │ MCP (HTTP+OAuth)
┌──────────────────────────────────────────────────┼───────────────┼───────────────┼───────────────────────── CONTROL PLANE ─┐
│                                                                                                                            │
│  ┌────────────────┐   ┌────────────────────┐   ┌───────────────────┐   ┌────────────────────┐   ┌───────────────────────┐   │
│  │  API Gateway   │   │  Realtime Gateway  │   │  Webhook Ingress  │   │  MCP Server (P2)   │   │  Dashboard BFF        │   │
│  │  (NestJS REST) │   │  (SSE + WS fanout) │   │  (trackers/git)   │   │                    │   │  (aggregates reads)   │   │
│  └───────┬────────┘   └─────────┬──────────┘   └─────────┬─────────┘   └─────────┬──────────┘   └──────────┬────────────┘   │
│          │                      │ subscribe              │ normalize             │                        │                │
│          ▼                      ▼                        ▼                       ▼                        ▼                │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                    Core Services (NestJS modules)                                                   │  │
│  │  Tenancy/RBAC · Projects · WorkItems · Runs · Approvals · Policy · Connectors · Agents/Configs · Budgets · Audit    │  │
│  └───────┬───────────────────┬───────────────────┬──────────────────┬───────────────────┬────────────────────┬────────┘  │
│          │                   │                   │                  │                   │                    │           │
│          ▼                   ▼                   ▼                  ▼                   ▼                    ▼           │
│  ┌──────────────┐   ┌─────────────────┐   ┌──────────────┐   ┌──────────────┐   ┌───────────────┐   ┌────────────────┐  │
│  │ Run          │   │ Model Router    │   │ VCS Service  │   │ Tracker Svc  │   │ Tool Broker   │   │ Sandbox Broker │  │
│  │ Orchestrator │   │ (budgets/attr/  │   │ (VcsProvider │   │ (Tracker     │   │ (native +     │   │ (pool mgmt,    │  │
│  │ (Temporal    │   │  redact/cache)  │   │  adapters)   │   │  Provider)   │   │  MCP client)  │   │  lease/GC)     │  │
│  │  workflows)  │   └───────┬─────────┘   └──────┬───────┘   └──────┬───────┘   └───────┬───────┘   └───────┬────────┘  │
│  └──────┬───────┘           │                    │                  │                   │                   │           │
│         │ gRPC              ▼                    ▼                  ▼                   │                   │           │
│         │            ┌─────────────┐      GitHub/GitLab/       Jira/Linear/            │                   │           │
│         │            │  LiteLLM    │      Bitbucket/generic    GH Issues/Workdesk      │                   │           │
│         │            │  proxy      │                                                   │                   │           │
│         │            └──────┬──────┘                                                   │                   │           │
│         │                   ▼                                                          │                   │           │
│         │       OpenAI · Anthropic · Gemini · vLLM/Ollama (self-hosted)                │                   │           │
│         │                                                                              │                   │           │
│  ┌──────┴──────────────────────────────────────────────────┐                          │                   │           │
│  │  Infra: PostgreSQL · Redis · NATS/Redis Streams (bus) ·  │                          │                   │           │
│  │  MinIO/S3 · Temporal server · Secrets (Infisical) ·      │                          │                   │           │
│  │  OTel Collector · Prometheus · Grafana · Loki · Langfuse │                          │                   │           │
│  └────────────────────────────────────────────────────────┘                           │                   │           │
└────────────────────────────────────────────────────────────────────────────────────────┼───────────────────┼───────────┘
                                                                                         │ broker channel    │ lease
                                                                       (authenticated, outbound-initiated)   │
┌────────────────────────────────────────────────────────────────────────────────────────┼───────────────────┼──── EXECUTION PLANE ─┐
│                                                                                        ▼                   ▼                      │
│   ┌─────────────────────────────┐        ┌──────────────────────────────────────────────────────────────────────────────┐        │
│   │  Agent Worker (Python)      │        │  Sandbox Pool                                                                 │        │
│   │  - LangGraph runtime        │◄──────►│  Firecracker microVM per Run  (rootfs: node/python/dotnet/java/go toolchains)│        │
│   │  - Planner/Coder/Reviewer   │  exec  │   ├─ overlay FS + repo checkout                                              │        │
│   │  - Tool executors           │  tool  │   ├─ egress proxy (per-Project allowlist)                                    │        │
│   │  - Repo map / embeddings    │        │   └─ snapshot/restore for pause/resume                                       │        │
│   └──────────────┬──────────────┘        └──────────────────────────────────────────────────────────────────────────────┘        │
│                  │ model calls go back OUT to Model Router only (no other control-plane access)                                  │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 3. Service responsibilities

| Service | Language | Responsibility | Scale unit |
|---------|----------|----------------|-----------|
| **API Gateway** | TS/NestJS | REST API, authN/Z, request validation, rate limits, OpenAPI | stateless, HPA |
| **Realtime Gateway** | TS/NestJS (`ws` + SSE) | Subscribes to `EventBus`, fans out to browsers; WS control channel | stateless (SSE), sticky (WS) |
| **Webhook Ingress** | TS/NestJS | Verify signatures, dedupe, normalize tracker/Git webhooks → events + WorkItem upserts | stateless, HPA |
| **Dashboard BFF** | TS/NestJS | Read-optimized aggregation for dashboard screens (avoids N+1 from the SPA) | stateless, HPA |
| **Core Services** | TS/NestJS | Domain modules (Tenancy/RBAC, Projects, WorkItems, Runs, Approvals, Policy, Connectors, Agents, Budgets, Audit) | stateless, HPA |
| **Run Orchestrator** | TS worker + Temporal | Temporal workflows/activities for the Run lifecycle; emits events; enforces budgets/SLA timers | Temporal worker pool |
| **Model Router** | TS/NestJS | Budget enforcement, Run/Step attribution, redaction, cost ledger, cache, model catalog; proxies to LiteLLM | stateless, HPA |
| **VCS Service** | TS/NestJS | `VcsProvider` adapters, short-lived token minting, webhook registration, protected-branch checks | stateless, HPA |
| **Tracker Service** | TS/NestJS | `TrackerProvider` adapters, polling scheduler, status write-back | stateless + 1 scheduler leader |
| **Tool Broker** | TS/NestJS + Python helpers | Native tool registry + permissioning + idempotency; MCP client mounting external servers | stateless, HPA |
| **Sandbox Broker** | TS/NestJS | Pool sizing, VM lease/return, snapshot orchestration, GC, egress-policy push | stateless control; stateful pool |
| **Agent Worker** | Python | LangGraph graphs (Planner/Coder/Reviewer), tool execution inside sandbox, repo map, embeddings | worker pool, KEDA/HPA on queue depth |
| **MCP Server** (P2) | TS | Exposes Praxis read/act surface to external agents | stateless, HPA |

Early deployments MAY co-locate API Gateway + BFF + Core Services + Model Router + VCS + Tracker + Tool Broker into **one process** ("praxis-core") with modules; the split above is the target and the module boundaries are enforced from day one.

## 4. The Run: end-to-end control flow

1. **Intake.** Webhook Ingress (or poll) receives a ticket → Tracker Service normalizes → `WorkItem` upserted → `work_item.received` event. Intake filter decides: enqueue or wait for manual start.
2. **Start.** Operator/auto starts a Run → Core `Runs` module creates the `Run` row → starts a **Temporal workflow** `RunWorkflow(runId)`.
3. **Triage activity.** Calls Agent Worker (gRPC) with a lightweight model → classification + readiness. `not_suitable`/`needs_info` short-circuits with events + optional ticket comment.
4. **Repo prep activity.** Sandbox Broker leases a microVM; VCS Service mints a scoped token; the sandbox clones the repo at the base branch; Agent Worker builds a **repo map** and caches it.
5. **Plan activity.** Planner graph (LangGraph) inspects repo (repo map + `code.search` + targeted `fs.read`) → emits `Plan` (steps, files, tests, risk). Persisted + `plan.created` event. If Project requires plan approval → workflow raises an **Approval** and `await` a `approvalGranted` signal (Temporal timer = SLA).
6. **Execute loop.** For each Step: Coder graph runs the bounded reason→act→observe loop. Tool calls go through Tool Broker → executed in the sandbox → results streamed as events. Risky tool calls raise Approvals (signal-gated). Budget guard (tokens/USD/time/iterations/files) checked each turn; soft breach → Approval, hard breach → abort activity.
7. **Verify activity.** Run the Project verification pipeline in the sandbox (build/lint/unit/integration/E2E). Failures feed back into the fix loop (bounded). Reports stored as Artifacts.
8. **Review activity.** Reviewer graph evaluates the final diff vs acceptance criteria → structured verdict. `block` → back to fix loop or human, per config.
9. **Deliver activity.** If Project requires delivery approval → Approval + signal. Then: commit (conventional message) → push branch (idempotency key) → open/update PR/MR with the full body (summary, AC checklist, verification, AI review, cost/time, Run backlink). `run.delivered` event; optional ticket link/comment.
10. **Close.** Workflow completes → `Run` `succeeded`; Sandbox Broker GCs the VM (snapshot retained per retention policy); analytics rollup job updates aggregates.

Failure at any activity → categorized failure, events emitted, sandbox GC'd, Run `failed` with a resumable checkpoint where possible.

## 5. Data flow: real-time to the dashboard

```
Agent Worker / Orchestrator / Services
        │  append typed event
        ▼
Postgres run_events  ──(source of truth for timeline & backfill)
        │  publish
        ▼
EventBus (Redis Streams / NATS JetStream)   ── topic per tenant + per run
        │  subscribe
        ▼
Realtime Gateway  ──► SSE stream  ──► Dashboard (live activity, logs, timeline, counters)
        └─────────► WS channel ──► Dashboard (pause/resume/comment, approvals actions)
```

- SSE clients send `Last-Event-ID`; the gateway backfills missed events from `run_events` then resumes the live tail.
- Fleet-level counters are maintained as materialized aggregates updated by an event consumer, pushed on a throttled interval (≤ 1 s) to avoid churn.
- No dashboard screen computes progress locally; every indicator is bound to an event or a BFF read that reflects persisted state.

## 6. Deployment topologies

### 6.1 Local / all-in-one (`docker compose up`)
Single host. Containers: `praxis-core`, `praxis-orchestrator`, `praxis-agent` (1–2), `sandbox-broker`, `sandbox-runner` (gVisor or Firecracker if `/dev/kvm` present, else `docker` backend with a loud warning), `postgres`, `redis`, `temporal` + `temporal-ui`, `minio`, `litellm`, `infisical`, `otel-collector`, `grafana`, `prometheus`, `loki`, `langfuse`, `dashboard`, plus `stub-tracker` and `gitea` (local Git server) for the offline demo. Seed script creates a demo Tenant + Project + sample WorkItem.

### 6.2 Small production (single K8s cluster)
- Namespace `praxis-control`: Deployments (HPA) for gateway/BFF/core/orchestrator/model-router/vcs/tracker/tool-broker/realtime; Temporal (Helm) with its own Postgres; app Postgres (operator or managed); Redis; NATS; MinIO or cloud S3; Infisical; observability stack (or OTLP export to existing).
- Namespace `praxis-exec`: Agent Worker Deployment (KEDA scaler on queue depth) + Sandbox Pool DaemonSet/Deployment on a **dedicated node group** with nested virtualization (Firecracker) or a gVisor RuntimeClass node group. NetworkPolicies: exec namespace may reach only the Model Router and Tool Broker ingress; deny all else, deny cloud metadata.

### 6.3 Multi-tenant SaaS (future)
- Regional cells; per-cell control plane; sandbox pools on bare-metal/`.metal` node groups; per-tenant network namespaces and egress proxies; noisy-neighbor controls via per-tenant concurrency + budget; Postgres per cell with row-level tenant scoping + optional schema-per-large-tenant.

## 7. Cross-cutting concerns

| Concern | Mechanism |
|---------|-----------|
| **Tenancy** | `tenant_id` on every row; enforced in a NestJS query interceptor + Postgres RLS as defense-in-depth; cross-tenant id → 404. |
| **Idempotency** | Client `Idempotency-Key` on mutating REST; Temporal activity idempotency keys for push/PR; webhook dedupe table. |
| **Config** | 12-factor env + mounted secret files; a typed config module validates on boot and fails fast. |
| **Migrations** | TypeORM migrations (app DB) + Alembic (Python-owned tables, if any) run as pre-deploy jobs; expand/contract only. |
| **Versioning** | API `/{v1}`; provider/connector/tool packages semver'd with contract-test gates; events carry a `schema_version`. |
| **Time & determinism** | Temporal workflows use workflow-safe time; all timestamps UTC ISO-8601; agent non-determinism confined to activities. |
| **Backpressure** | Per-Tenant/Project Run concurrency caps; queue depth drives worker autoscale; Model Router queues on provider 429 with jittered retry. |
| **Failure isolation** | A provider outage pauses affected Runs (not fail); a sandbox host failure re-leases and resumes from the last checkpoint; a connector outage degrades intake only. |

## 8. Key architectural decisions (ADR index)

| ADR | Decision | Doc |
|-----|----------|-----|
| ADR-001 | Two-plane split (control vs execution), outbound-only exec connectivity | this doc §1, [14](./14-security.md) |
| ADR-002 | Temporal for Run orchestration; LangGraph for the in-agent loop | [04](./04-technology-research.md) §1,§3 · [06](./06-agent-architecture.md) |
| ADR-003 | All model calls via Model Router → LiteLLM; no direct SDK use | [07](./07-ai-provider-abstraction.md) |
| ADR-004 | Own `VcsProvider`/`TrackerProvider` contracts, not a unified-API SaaS | [08](./08-git-provider-abstraction.md), [09](./09-integration-tool-architecture.md) |
| ADR-005 | Firecracker microVM pool via `SandboxProvider`; gVisor/docker fallbacks | [04](./04-technology-research.md) §6, [14](./14-security.md) |
| ADR-006 | Event-sourced Run timeline in Postgres; bus is a projection | [11](./11-event-architecture.md) |
| ADR-007 | SSE for streams + WS for control; AG-UI-style typed events | [11](./11-event-architecture.md), [12](./12-dashboard-ui-spec.md) |
| ADR-008 | MCP as interop extension path, native gRPC tools internally | [09](./09-integration-tool-architecture.md) |
| ADR-009 | Polyglot TS (control) + Python (agents), gRPC + shared schemas | [04](./04-technology-research.md) §2 |
| ADR-010 | Postgres + pgvector first; Qdrant/NATS/Kafka introduced only on proven need | [04](./04-technology-research.md) §8,§9 |
