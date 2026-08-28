# Praxis — AI Execution Platform

> **Working title:** Praxis (codename for the "AI Employee" platform)
> **One-liner:** A production-grade platform where AI agents *plan and execute* real engineering work — pull a ticket, analyze it, branch, implement, test end-to-end, and open a PR/MR for human review — across any AI provider, any Git host, and any task tracker.

This is not a chatbot. It is an execution platform: durable, observable, sandboxed, multi-tenant, and provider-agnostic.

---

## How to read this PRD

The PRD is split into focused documents. Read them in order for a full picture, or jump to the one you need.

| # | Document | What it covers |
|---|----------|----------------|
| 00 | [Glossary](./00-glossary.md) | Shared vocabulary used across every doc |
| 01 | [Product Vision](./01-product-vision.md) | Problem, users, differentiation, VIKTOR study, non-goals |
| 02 | [Requirements](./02-requirements.md) | Functional + non-functional requirements, constraints |
| 03 | [User Stories](./03-user-stories.md) | Personas and story-level acceptance criteria |
| 04 | [Technology Research & Decisions](./04-technology-research.md) | Alternatives compared, choices made, rationale |
| 05 | [System Architecture](./05-system-architecture.md) | Services, boundaries, data flow, deployment topology |
| 06 | [Agent Architecture](./06-agent-architecture.md) | Agent runtime, planner/executor, memory, context, HITL, loop control |
| 07 | [AI Provider Abstraction](./07-ai-provider-abstraction.md) | Model gateway, provider adapters, routing, cost, streaming |
| 08 | [Git Provider Abstraction](./08-git-provider-abstraction.md) | VCS operations, PR/MR, webhooks, GitHub/GitLab/Bitbucket/generic |
| 09 | [Integration & Tool Architecture](./09-integration-tool-architecture.md) | Tool system, MCP, connectors (Slack/Jira/Linear), registry |
| 10 | [Database Architecture](./10-database-architecture.md) | Datastores, schema, ERD, migrations, retention |
| 11 | [Event Architecture](./11-event-architecture.md) | Event bus, event catalog, real-time delivery |
| 12 | [Dashboard & UI Specification](./12-dashboard-ui-spec.md) | Screens, components, real-time UX, wireframes |
| 13 | [API Design](./13-api-design.md) | Resource model, endpoints, errors, versioning, SDKs |
| 14 | [Security](./14-security.md) | AuthN, RBAC, secrets, sandboxing, audit, threat model |
| 15 | [Observability](./15-observability.md) | Logs, metrics, traces, OTel GenAI, cost, alerting |
| 16 | [Infrastructure & Docker](./16-infrastructure-docker.md) | Compose stack, images, Kubernetes path, CI/CD |
| 17 | [Testing Strategy](./17-testing-strategy.md) | Test pyramid, agent eval harness, load, security testing |
| 18 | [Implementation Roadmap](./18-implementation-roadmap.md) | Phase overview, milestones, dependencies, team, risk register |
| — | [phases/](./phases/) | Per-phase task breakdowns (0–6) with DoD and acceptance criteria |

---

## The core loop (what the platform automates)

```
Task Tracker (Jira / Linear / GitHub Issues / EDAP Workdesk / …)
        │  webhook or poll
        ▼
┌──────────────────────────────────────────────────────────────┐
│ INTAKE          Normalize ticket → WorkItem                   │
│ TRIAGE          Classify, estimate, check readiness, route    │
│ PLAN            Agent inspects repo → produces step plan      │
│ APPROVE (opt)   Human gate on plan / risky steps             │
│ EXECUTE         Branch → edit → run → test → fix loop         │
│   ├── sandboxed workspace (microVM/container)                │
│   ├── tool calls: fs, shell, search, test, git              │
│   └── bounded iterations + budget guard                     │
│ VERIFY          Build + unit + integration + E2E             │
│ REVIEW (AI)     Self-review diff vs acceptance criteria      │
│ DELIVER         Commit → push → open PR/MR                    │
└──────────────────────────────────────────────────────────────┘
        ▼
👤 Human reviews & merges (always manual — platform never merges by default)
```

Every stage emits typed events. The dashboard renders those events live. Nothing on the frontend is simulated.

---

## Design principles

1. **Execution over conversation.** Agents produce commits, PRs, test runs — artifacts, not just text.
2. **Provider-agnostic by contract.** AI providers, Git hosts, and trackers sit behind stable interfaces. Swapping one is a config change, not a rewrite.
3. **Durable and resumable.** Long jobs survive worker restarts, deploys, and day-long human-approval waits.
4. **Sandboxed by default.** Agent code execution never touches the control plane, production credentials, or the host.
5. **Human holds the merge.** Destructive and outward-facing actions require explicit approval; merge is always manual.
6. **Observable end to end.** Every token, tool call, cost, and state transition is traced and queryable.
7. **Local-first, cloud-ready.** `docker compose up` runs the whole platform on a laptop; the same artifacts deploy to Kubernetes.

---

## Tech stack at a glance

| Layer | Choice | Why (short) |
|-------|--------|-------------|
| Control-plane API | **TypeScript / NestJS** | Matches existing EDAP Workdesk; strong DI, WebSocket + REST, mature |
| Agent runtime & workers | **Python + LangGraph** | Best agent ecosystem, graph checkpointing, HITL interrupts, model-agnostic |
| Durable orchestration | **Temporal** | Polyglot, day-long workflows, mature retries/timeouts, HITL signals |
| Model gateway | **LiteLLM (self-hosted)** + internal `ModelRouter` | 100+ providers, OpenAI-compatible, air-gappable, cost tracking |
| Sandbox | **Firecracker microVM** (via E2B-style pool) with gVisor fallback | Hardware-grade isolation for untrusted agent code |
| Event bus | **Redis Streams** (dev) → **NATS JetStream** (scale) | Simple locally, horizontally scalable later |
| Real-time to browser | **SSE** for streams + **WebSocket** for control | SSE = cheap, CDN-friendly, auto-reconnect; WS for bidirectional |
| Primary DB | **PostgreSQL** | Relational core, JSONB for flexible payloads, `pgvector` for memory |
| Object storage | **S3-compatible (MinIO local)** | Artifacts, logs, diffs |
| Secrets | **Infisical** (self-host) with Vault/OpenBao adapter | DX-friendly, CI-native; adapter keeps enterprise path open |
| Observability | **OpenTelemetry** + **Langfuse** + **Prometheus/Grafana** | OTel GenAI semconv as the portability standard |
| Dashboard | **Angular 21** (signals) or **Next.js/React** | Angular reuses EDAP Workdesk skills; see [04](./04-technology-research.md) |

Full rationale and rejected alternatives: **[04-technology-research.md](./04-technology-research.md)**.

---

## Relationship to the existing EDAP systems

- **EDAP Workdesk / edap-ticketing-service** (`D:\Task Managemnet System`) — NestJS 10 + TypeORM + MSSQL + Socket.io + Angular 21, already integrates `@anthropic-ai/sdk`. Praxis treats Workdesk as **one task-tracker connector among many** via the [Tracker abstraction](./09-integration-tool-architecture.md). Praxis does not fork or depend on Workdesk internals; it consumes its REST + `/workdesk` socket events through the connector contract.
- Praxis is a **separate deployable**. It can run fully standalone with GitHub Issues + GitHub as the only integrations.
```
