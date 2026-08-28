# 04 — Technology Research & Decisions

This document compares alternatives for every major technology area and records the decision plus rationale. Decisions are **revisable**: each has a "revisit trigger". Research reflects the state of the ecosystem as of **mid/late 2026**.

Legend: ✅ chosen · 🟨 fallback / adapter kept · ❌ rejected for this platform

---

## 0. Summary decision table

| Area | Decision | Key alternatives rejected |
|------|----------|---------------------------|
| Control-plane language/framework | ✅ **TypeScript + NestJS** | Python/FastAPI, Go |
| Agent runtime language | ✅ **Python** | TypeScript-only |
| Agent orchestration framework | ✅ **LangGraph** (Python) | CrewAI, OpenAI Agents SDK, AutoGen/AG2, Mastra, custom |
| Durable workflow engine | ✅ **Temporal** | Inngest, Restate, Hatchet, DBOS, BullMQ-only |
| Job queue (short tasks) | ✅ **BullMQ** (TS) + **Temporal activities** (Python) | Celery, RQ, raw Redis |
| Model gateway | ✅ **LiteLLM self-hosted** + thin internal `ModelRouter` | Portkey, OpenRouter, Vercel AI Gateway, per-SDK |
| Code sandbox | ✅ **Firecracker microVM pool** (own control loop, E2B-compatible API) | Docker-only, gVisor-only, E2B SaaS, Daytona SaaS, Modal |
| Sandbox fallback | 🟨 **gVisor container** (no-KVM environments) | — |
| Event bus | ✅ **Redis Streams** (dev/small) → **NATS JetStream** (scale) | Kafka, RabbitMQ, Redis pub/sub only |
| Real-time to browser | ✅ **SSE** for one-way streams + **WebSocket** for bidirectional control | WS-only, long-polling, GraphQL subscriptions |
| Real-time protocol shape | ✅ **AG-UI-style typed events** over SSE | ad-hoc JSON |
| Primary database | ✅ **PostgreSQL 16+** (+ `pgvector`, JSONB) | MySQL, Mongo, CockroachDB |
| Vector store | ✅ **pgvector** (start) → **Qdrant** (if scale demands) | Pinecone, Weaviate, Milvus |
| Object storage | ✅ **S3 API** (MinIO local, cloud S3/GCS prod) | local disk, DB blobs |
| Cache / ephemeral state | ✅ **Redis** | Memcached |
| Secrets | ✅ **Infisical** self-host + `SecretsProvider` adapter (Vault/OpenBao) | Vault-only, env files, Doppler SaaS |
| Tool/extension protocol | ✅ **MCP** (spec 2026-07-28) as first-class extension path | proprietary plugin API only |
| Observability | ✅ **OpenTelemetry** (traces/metrics/logs) + **Langfuse** (LLM traces/evals) + **Prometheus + Grafana** + **Loki** | Datadog-only, LangSmith, bare ELK |
| Auth | ✅ **OIDC/OAuth2** (Keycloak/Ory for self-host) + JWT/refresh | roll-your-own, Auth0-only |
| Container orchestration | ✅ **Docker Compose** (local) + **Kubernetes/Helm** (prod) | Nomad, ECS-only, bare VMs |
| Dashboard framework | ✅ **Angular 21 (signals)** — reuse EDAP skills; **Next.js/React** acceptable alt | Vue, SvelteKit |
| Git provider integration | ✅ **Custom `VcsProvider` contract** over Octokit / `@gitbeaker` / Bitbucket API + isomorphic-git/CLI | unified-API SaaS (Nango/Ampersand), single SDK |
| Tracker integration | ✅ **Custom `TrackerProvider` contract**; connectors per system | unified-API SaaS |
| CI for the platform | ✅ **GitHub Actions** (or GitLab CI mirror) | Jenkins |

---

## 1. Agent orchestration framework

### Requirements it must satisfy
Durable/checkpointed state across day-long runs; first-class **human-in-the-loop interrupts**; model-agnostic; explicit control over the plan→act→observe loop; multi-agent handoff (Coder/Reviewer); streaming of steps + tokens; Python (see §2); production track record.

### Alternatives

| Framework | Strengths | Weaknesses for us | Verdict |
|-----------|-----------|-------------------|---------|
| **LangGraph** | Explicit state graph; **checkpointer** (Postgres) for durable pause/resume; `interrupt()` for HITL at business boundaries; streaming of state + tokens; model-agnostic; large production usage; AG-UI support | Steeper learning curve; graph boilerplate; LangChain-adjacent surface area to manage | ✅ **chosen** |
| **CrewAI** | Fast to prototype; role/task metaphor maps to Coder/Reviewer | Less precise control over each transition; durability/HITL less mature; opinionated | ❌ prototyping-oriented |
| **OpenAI Agents SDK** | Minimal primitives; 100+ models via LiteLLM; quick start | Thin on durable state & HITL; handoff-chain model too simple for a bounded fix loop with approvals; leans OpenAI ergonomics | ❌ too thin for our loop |
| **AutoGen / AG2** | Rich multi-agent conversation patterns | Microsoft moved AutoGen to maintenance; strategic focus shifted to MS Agent Framework — adoption risk | ❌ maintenance mode |
| **Mastra** (TS) | Best-in-class TS DX; studio UI; suspend/resume; Inngest runner | TypeScript-first (we want Python for the agent runtime — §2); younger ecosystem for code-agent tooling | 🟨 credible if we ever flip the runtime to TS |
| **Custom loop** | Zero framework lock-in | We'd reinvent checkpointing, replay, HITL, streaming — months of undifferentiated work | ❌ |

### Decision
✅ **LangGraph** for the agent control loop, running on Python workers. Durability comes from **two layers**: LangGraph's Postgres checkpointer for intra-agent state, and **Temporal** (§3) wrapping the whole Run for infra-level durability, retries, and approval signals. LangGraph `interrupt()` maps to our Approval/HITL gates; Temporal signals deliver the human decision back.

> We keep LangGraph usage **behind our own `AgentRuntime` interface** so a future swap (to Mastra, OpenAI Agents SDK, or a custom loop) touches one package, not the platform.

**Revisit trigger:** LangGraph checkpointer perf becomes a bottleneck at >200 concurrent Runs, or a materially better durable-agent runtime emerges.

---

## 2. Language & framework split

### Why polyglot (TS + Python)

- **Control plane (API, orchestration glue, dashboard BFF, connectors, event fan-out):** **TypeScript / NestJS**. Rationale: the existing EDAP Workdesk is NestJS + Angular + Socket.io — the team already runs this stack; NestJS gives DI, guards/interceptors for RBAC, WebSocket + REST + queue processors in one framework; excellent Git provider SDKs (Octokit, gitbeaker) are TS-native.
- **Agent runtime & ML-adjacent work (LangGraph graphs, tool executors, repo-map/embeddings, eval harness):** **Python**. Rationale: the agent, LLM, MCP, and code-intelligence ecosystems are Python-first; LangGraph's richest surface is Python; `tree-sitter`, `chromadb`/`qdrant-client`, `mcp` SDK, eval tooling all Python-native.

### Rejected
- **All-Python (FastAPI everywhere):** loses NestJS structural benefits and EDAP skill reuse; TS Git SDKs are better maintained.
- **All-TypeScript:** the agent ecosystem in TS (Mastra, Vercel AI SDK) is good but the code-intelligence / eval / MCP tooling depth is in Python; we'd fight the ecosystem.
- **Go for the control plane:** stakeholder constraint limits first-party languages to TS/Python; Go allowed only for a proven-necessary component (candidate: the SSE fan-out gateway if Node can't hold the connection count — decided by a Phase 2 spike, not assumed).

### Contract between the two
gRPC (proto-defined) for control-plane ↔ agent-worker RPC; shared event schemas (JSON Schema, generated types for both languages); no shared code, only shared contracts.

**Revisit trigger:** operational cost of two runtimes outweighs ecosystem benefit; or a spike shows Mastra+TS covers the agent needs with acceptable eval tooling.

---

## 3. Durable workflow engine

### Why we need one
A Run spans minutes to **days** (human approval waits), must survive worker crashes and deploys, needs per-step retries/timeouts distinct from the LLM loop, needs exactly-once delivery (push/PR), and needs external signals (approve/cancel/comment).

### Alternatives

| Engine | Strengths | Weaknesses | Verdict |
|--------|-----------|------------|---------|
| **Temporal** | Mature; **polyglot SDKs (TS + Python + Go)** — fits our split; day/week-long histories; deep retry/timeout config; signals for HITL; OpenAI Agents SDK integration (preview); large production roster (OpenAI, Replit, Cursor, Retool) | Operationally heavier (server + workers + DB/ES); deterministic-workflow discipline | ✅ **chosen** |
| **Inngest** | Fastest path for TS; serverless-native; managed durable runtime | TS-centric; managed-first (self-host less battle-tested); less explicit timeout control | ❌ TS-only bias, less control |
| **Restate** | Lightweight, fast, durable RPC model | Younger ecosystem; smaller community; fewer polyglot references | 🟨 watch |
| **Hatchet** | Postgres-backed queue + durable tasks; simpler ops; good concurrency controls | Less mature deterministic replay; smaller ecosystem | 🟨 fallback if Temporal ops burden too high |
| **DBOS** | Durable execution as a library on Postgres; minimal infra | Newer; language coverage narrower; fewer long-history references | ❌ for now |
| **BullMQ only** | Trivial ops; great for short jobs | Not a workflow engine — no replay, no long-lived orchestration, no signals | ❌ as the orchestrator (✅ as a queue, §4) |

### Decision
✅ **Temporal** as the Run orchestrator. One Temporal **workflow per Run**; **activities** for: normalize ticket, build repo map, call agent-step (delegates to Python LangGraph worker via gRPC), run tool, run verification, open PR. **Signals**: `approvalGranted`, `approvalRejected`, `cancel`, `operatorMessage`, `pause`, `resume`. **Timers**: approval SLA, Run wall-clock budget.

Layering with LangGraph: Temporal owns *infra durability and orchestration*; LangGraph owns *the reasoning loop within an agent step*. LangGraph checkpoints let a single agent step resume; Temporal history lets the whole Run resume even if the checkpoint DB round-trips fail.

**Revisit trigger:** Temporal cluster ops cost is disproportionate for target deployment sizes → evaluate Hatchet or Restate with the same `RunOrchestrator` interface.

---

## 4. Job queue for short tasks

Short, non-orchestration jobs: webhook processing, notification sends, connector polls, artifact post-processing, analytics rollups.

✅ **BullMQ** (Redis-backed) in the NestJS control plane for TS-side jobs; ✅ **Temporal activities** for Python-side units already inside a Run. ❌ Celery/RQ — would add a third runtime concern; we already have Redis + Temporal.

---

## 5. Model gateway / multi-provider AI

### Requirements
Single egress for all LLM calls; OpenAI + Anthropic + Gemini at MVP + Codex-class + self-hosted OpenAI-compatible; normalized tool-calling & streaming; failover/retry; per-Run/Project/Tenant cost metering; redaction + no-train headers; optional caching; **self-hostable / air-gap capable**.

### Alternatives

| Option | Strengths | Weaknesses | Verdict |
|--------|-----------|------------|---------|
| **LiteLLM (self-hosted proxy)** | 100+ providers; OpenAI-compatible API; self-host / air-gap; budgets, keys, routing, fallbacks; low overhead (Rust proxy path); OpenAI Agents SDK & LangChain integration | Config sprawl; you operate it; some provider-specific features lag | ✅ **chosen** (self-hosted) |
| **Portkey** | First-party observability dashboards; 1600+ providers; guardrails; SOC 2 | SaaS-leaning; self-host is enterprise; another vendor | 🟨 adapter-compatible alt |
| **OpenRouter** | Widest hosted catalog, least setup; OpenAI-style API | Hosted-only (no air-gap); routes through their infra; pricing markup on some routes | ❌ conflicts with self-host/air-gap |
| **Vercel AI Gateway** | Zero-secret OIDC; great with AI SDK; proven fallback rescue rate | Vercel-ecosystem gravity; hosted | ❌ not our stack |
| **Per-provider SDKs directly** | No middle layer | Reimplement routing/failover/metering/redaction N times; violates FR-AI-1 | ❌ |

### Decision
✅ **LiteLLM self-hosted** as the provider fan-out, fronted by a **thin internal `ModelRouter`** service (NestJS) that owns *our* concerns LiteLLM shouldn't: per-Run budget enforcement, Run/Step attribution tags, prompt-injection-aware redaction, our cost ledger, semantic cache policy, and the `ModelProvider` capability catalog used for routing decisions. Agents and services call `ModelRouter`; `ModelRouter` calls LiteLLM; LiteLLM calls providers.

```
Agent worker ─► ModelRouter (budgets, attribution, redaction, cache, catalog)
                   └─► LiteLLM proxy (provider adapters, failover, key mgmt)
                          └─► OpenAI / Anthropic / Gemini / vLLM / Ollama / ...
```

**"Codex" / code models:** treated as just another model id in the catalog (e.g. an OpenAI code-optimized model, or a self-hosted code model via vLLM). No special path.

**Revisit trigger:** LiteLLM proxy becomes an availability/perf bottleneck, or we need Portkey-grade guardrails we can't build cheaply → swap the layer behind `ModelRouter`.

---

## 6. Code execution sandbox

### Requirements
Run untrusted, agent-authored code and arbitrary `git`/build/test commands with **hardware-grade isolation**; fast start; per-Run ephemeral filesystem; controllable egress; snapshot/restore for resume; no ambient cloud creds; works self-hosted and in the cloud pool.

### Isolation technology comparison

| Tech | Isolation | Cold start | GPU | Notes |
|------|-----------|-----------|-----|-------|
| **Firecracker microVM** | Hardware (KVM), separate kernel | ~125 ms VM + rootfs time (sub-second with warm pool) | via VFIO passthrough | Used by E2B, AWS Lambda, Vercel; strongest practical boundary for untrusted code |
| **gVisor (runsc)** | User-space kernel, syscall interception | Fast (container-like) | Limited (intercepts GPU calls) | Used by Modal; good boundary, needs no KVM (works in more places, incl. some CI) |
| **Plain Docker / runc** | Namespaces + cgroups, shared kernel | Fastest | Native | Not sufficient alone for untrusted code; fine as an inner layer |
| **Kata Containers** | Hardware VM, OCI-compatible | Slower than Firecracker | Yes | Heavier; good K8s story |

### Product options

| Option | Strengths | Weaknesses | Verdict |
|--------|-----------|------------|---------|
| **Own Firecracker pool** (E2B-compatible API surface) | Full control; self-host & air-gap; no per-sandbox SaaS cost; snapshot/restore for Run resume; can run in customer VPC | We build the pool manager, rootfs images, networking, GC | ✅ **chosen** |
| **E2B (SaaS or self-host)** | Purpose-built; SDKs; fast | SaaS sends code off-box (dealbreaker for some customers); self-host still maturing | 🟨 API-compatible so we can offer it as a backend |
| **Daytona** | Container-based, fast cold start, dev-env focus | Shared-kernel isolation; SaaS gravity | ❌ isolation model |
| **Modal** | gVisor sandboxing, great DX, scale | SaaS; egress of code; pricing model | ❌ SaaS |
| **Docker-only** | Trivial | Inadequate isolation for untrusted code | ❌ (but used as fallback tier for trusted internal demos) |

### Decision
✅ A **`SandboxProvider` interface** with three backends:
1. **`firecracker-pool`** (default prod) — our microVM pool manager: warm pool, per-Run VM from a base rootfs (language toolchains preinstalled), overlay FS, snapshot on pause, restore on resume, hard GC on Run end. Egress via a per-Run network namespace with an allowlisting proxy.
2. **`gvisor`** — for hosts without nested virtualization (some CI/K8s). Same API, `runsc` runtime.
3. **`docker`** — local dev / trusted demos only; documented as **not** an isolation boundary.

Also expose **`e2b`** as an optional backend for teams that want a managed pool.

**Revisit trigger:** microVM pool ops cost is too high for small deployments → make `gvisor` the default for those and reserve Firecracker for multi-tenant SaaS.

---

## 7. MCP (Model Context Protocol)

### State (spec `2026-07-28`, "largest revision since launch")
Tier-1 SDKs (TS, Python, Go, C#) ship with the spec; OAuth hardened — clients validate `iss` per RFC 9207, servers implement **OAuth 2.0 Protected Resource Metadata (RFC 9728)**, Dynamic Client Registration sets `application_type`; stateless/streamable-HTTP transport emphasis; a **Registry** exists for discovery.

### Decision
✅ MCP is a **first-class extension path**, not the internal tool bus.
- **Praxis as MCP client:** the `ToolRegistry` can mount external MCP servers (stdio for local, streamable HTTP + OAuth 2.1 for remote). Their tools/resources are surfaced to agents under Policy, appear in tool-call logs identically to native tools, and are risk-tiered by the admin.
- **Praxis as MCP server (P2):** expose a curated read/act surface (`list_work_items`, `get_run`, `start_run`, `post_comment`) so external agents/IDEs can drive Praxis.
- **Internal tools stay native** (gRPC-defined) for latency, typed contracts, and fine-grained permissioning; MCP is the *interop* layer.

**Why not "MCP for everything internally":** extra transport/auth overhead per call, weaker compile-time contracts, and our tools need per-Step allowlisting and idempotency metadata that our native contract expresses directly.

**Revisit trigger:** MCP tooling/perf matures enough that native + MCP duplication isn't worth it.

---

## 8. Event bus & real-time delivery

### Internal event bus

| Option | Strengths | Weaknesses | Verdict |
|--------|-----------|------------|---------|
| **Redis Streams** | Already have Redis; consumer groups; trivial local; good to mid-scale | Not a long-term log; memory-bound; weaker multi-DC | ✅ dev + small prod |
| **NATS JetStream** | Lightweight, fast, subjects + durable streams, K8s-friendly, good fan-out | Another component to run | ✅ scale tier (same `EventBus` interface) |
| **Kafka / Redpanda** | Gold standard for high-throughput durable logs; replay | Heavy ops for our scale; overkill for a control plane | ❌ until a customer truly needs it |
| **RabbitMQ** | Mature routing | Less suited to event-log/replay + fan-out to SSE | ❌ |

✅ **`EventBus` interface** with `redis-streams` and `nats` implementations. Events are also persisted to Postgres (`run_events` table) as the source of truth for the timeline; the bus is for live fan-out.

### Browser real-time

SSE vs WebSocket (2026 guidance): **SSE** for one-way server→client streams — traverses CDNs/proxies, auto-reconnects with `Last-Event-ID`, cheaper to hold, stateless-scalable behind a fan-out; **WebSocket** where the client must push frequently.

### Decision
- ✅ **SSE** for: live agent activity, token streams, log tails, timeline updates, fleet counters. Reconnect + `Last-Event-ID` backfill from `run_events`.
- ✅ **WebSocket** for: the interactive "steer a Run" channel (pause/resume/comment round-trips), operator presence, and the approvals inbox live actions. (NestJS gateway; mirrors EDAP Workdesk's Socket.io pattern but we prefer raw WS/`ws` + a thin protocol; Socket.io acceptable if the team prefers parity.)
- ✅ Event **shape follows AG-UI**: typed events (`RUN_STEP_START`, `TOOL_CALL_START`, `TOOL_CALL_RESULT`, `TEXT_MESSAGE_CONTENT`, `RUN_ERROR`, `APPROVAL_REQUESTED`, …). This gives us a documented contract and lets CopilotKit-style UIs or third parties consume the stream.
- Horizontal scale: a stateless **SSE/WS gateway** service subscribes to the `EventBus` and fans out to connected clients; sticky sessions not required for SSE.

**Revisit trigger:** connection counts exceed what Node comfortably holds per instance → spike a Go fan-out gateway (allowed as a proven-necessary component) or adopt a managed real-time layer.

---

## 9. Databases & storage

| Need | Choice | Rationale | Rejected |
|------|--------|-----------|----------|
| Relational core (tenants, projects, runs, steps, approvals, audit, connectors) | ✅ **PostgreSQL 16+** | ACID, JSONB for raw payloads/plans, mature, `pgvector`, logical replication, PITR | MySQL (weaker JSON/ext story), Mongo (we need relational integrity) |
| Vector / memory | ✅ **pgvector** now, 🟨 **Qdrant** if recall latency/scale demands | One datastore to operate initially; Qdrant behind the same `VectorStore` interface | Pinecone/Weaviate (SaaS or extra ops before proven needed) |
| Cache, locks, BullMQ, Redis Streams, sandbox pool state | ✅ **Redis 7+** | Multi-purpose, ubiquitous | Memcached (fewer features) |
| Object storage (artifacts, diffs, logs, snapshots) | ✅ **S3 API** — MinIO local, cloud S3/GCS/Azure Blob prod | Portable, cheap, versioned; streamed through an authenticated endpoint (mirrors EDAP Workdesk's attachment pattern) | DB blobs (bloat), local disk (not HA) |
| Time-series metrics | ✅ **Prometheus** (+ Thanos/Mimir if long retention) | Standard, Grafana-native | InfluxDB |
| Trace storage | ✅ OTel Collector → **Tempo** (or Jaeger); LLM traces also to **Langfuse** | OTel-native; Langfuse adds eval/session replay | vendor lock-in |
| Log aggregation | ✅ **Loki** | Cheap, label-based, Grafana-native | full ELK (heavy) |

Temporal needs its own persistence (Postgres) + optional Elasticsearch for advanced visibility — run as a dedicated Temporal DB, not shared with app tables.

---

## 10. Secrets management

Guidance (2026): Infisical = DX + CI-native, no dynamic secrets/PKI; OpenBao = Vault-class, MPL-2.0, Vault-API-compatible; Vault = deepest but BUSL license (IBM/HashiCorp).

✅ **`SecretsProvider` interface**. Default impl: **Infisical** (self-host, MIT core) — great DX for the common case (provider API keys, Git tokens, connector creds), native K8s/Docker/CI integrations, built-in rotation for common services. 🟨 **OpenBao** adapter for customers who need dynamic secrets / PKI / transit encryption. ❌ plain env files for anything beyond local `.env`; ❌ storing secrets in Postgres.

Sandbox injection: secrets are fetched by the control plane, passed to the runner over the authenticated channel, mounted as a `tmpfs` file or scoped env inside the microVM for the Run's lifetime, and wiped on teardown. The agent's LLM context never contains raw secrets (redaction at `ModelRouter`).

---

## 11. Observability stack

Guidance (2026): OTel GenAI semantic conventions are the portability standard (agent spans still "experimental"); Langfuse (MIT, self-host) strong for agent debugging/session replay/evals; Phoenix (OTel/OpenInference-native) strong for eval rigor; LangSmith best only if you're all-in on LangChain SaaS.

✅ **OpenTelemetry everywhere** (SDKs in both TS and Python) → **OTel Collector** → Prometheus (metrics) + Tempo (traces) + Loki (logs).
✅ **Langfuse** (self-hosted) as the LLM-native lens: every `ModelRouter` call and agent step is also a Langfuse trace/observation; drives prompt/versioned-config evals and cost analytics that feed the dashboard.
✅ **Grafana** as the single pane; ship golden dashboards (RED/USE per service + fleet + cost).
🟨 **Phoenix** optional for offline eval deep-dives.
❌ Datadog/New Relic as a hard dependency — supported via OTLP export, not required.

Full detail: [15-observability.md](./15-observability.md).

---

## 12. Git provider integration

Guidance (2026): unified-API SaaS (Nango, Ampersand, Unified.to) exist and are good for *many-tenant SaaS integration sprawl*, but they add a vendor in the critical path and abstract away provider-specific PR/branch-protection nuances we care about.

✅ **Own `VcsProvider` contract** (see [08](./08-git-provider-abstraction.md)) implemented with best-of-breed native libs:
- GitHub → **Octokit** + GitHub App auth.
- GitLab → **@gitbeaker/rest**.
- Bitbucket → Bitbucket Cloud REST v2 (thin client).
- Generic → **git CLI in the sandbox** + optional patch artifact (no PR API).
Clone/checkout inside the sandbox uses the git CLI with a short-lived, path-scoped token minted per Run.

❌ Nango/Ampersand as a required layer — offered later only as an *optional* connector-hosting mode for teams that want it.

## 13. Tracker integration
Same reasoning: ✅ **own `TrackerProvider` contract**; connectors for GitHub Issues, EDAP Workdesk, Jira, Linear (see [09](./09-integration-tool-architecture.md)). Webhook-first with polling fallback; normalized to `WorkItem`.

---

## 14. Container orchestration & infra

✅ **Docker Compose** for local/all-in-one (FR-PLAT-7). ✅ **Kubernetes + Helm** for production: stateless control-plane Deployments with HPA; Temporal, Postgres, Redis, NATS, MinIO as operators/managed services; the **sandbox pool** as a dedicated node group with nested-virt (bare-metal or `.metal` instances) for Firecracker, or a gVisor node group otherwise. ❌ Nomad (smaller ecosystem for our team), ❌ ECS-only (cloud lock-in).

Images: distroless/slim, multi-arch (amd64+arm64), SBOM per build, signed (cosign). One image per service; config via env + mounted secrets.

---

## 15. Dashboard framework

| Option | For | Against |
|--------|-----|---------|
| **Angular 21 (standalone + signals)** | Direct skill reuse from EDAP Workdesk; Material + CDK; the team ships Angular today; SSE/WS clients straightforward | Heavier than React for a greenfield; smaller component-library market |
| **Next.js + React** | Largest ecosystem; CopilotKit/AG-UI React components exist; RSC/streaming; easy hiring | New stack for the team; another framework to maintain alongside Angular Workdesk |
| Vue / SvelteKit | Lean, fast | Least alignment with existing skills |

✅ **Default: Angular 21** to maximize velocity given the existing EDAP Angular 21 codebase and team familiarity (signals, Material, Socket.io patterns already in use). The dashboard is a **separate Angular app** (not bolted into Workdesk) talking to the Praxis BFF.
🟨 **Acceptable alternative: Next.js/React** if the team prefers the AG-UI/CopilotKit React ecosystem for the live-agent surfaces — the BFF contract is framework-neutral (REST + SSE + WS), so this is a front-end-only decision that can be made at Phase 3 kickoff.

**Revisit trigger:** the live-agent UX needs (generative UI, shared agent state) are materially easier with CopilotKit/AG-UI React bindings than hand-rolled Angular.

---

## 16. Things explicitly deferred / not chosen

- **Kafka** — revisit only if a customer needs multi-DC event replay at high volume.
- **A managed real-time SaaS** (Ably/Pusher/Liveblocks) — keeps data off customer infra; conflicts with self-host ethos.
- **A hosted agent platform** (Bedrock AgentCore, Vertex Agent Engine) — provider lock-in; we route *to* providers, we don't run *on* one.
- **Auto-merge** — Future, opt-in, per-Project, off by default.
- **Fine-tuning / model hosting** — out of scope; customers bring endpoints.
