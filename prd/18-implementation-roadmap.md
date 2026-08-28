# 18 — Implementation Roadmap

## 1. Phase overview

| Phase | Name | Goal | Exit = you can… | Rough duration* |
|-------|------|------|-----------------|-----------------|
| **0** | Research & Spikes | De-risk the hard unknowns | …point to a working spike for each red-flag area | 3–4 wks |
| **1** | Architecture & Foundations | Contracts, skeleton, CI, local stack | …`docker compose up` an empty-but-wired platform; contracts frozen v0 | 4–6 wks |
| **2** | Core Platform (pre-agent) | Tenancy, projects, runs state machine, events, dashboard shell, sandbox | …create a Project, start a Run that provisions a sandbox and streams fake steps to the dashboard | 6–8 wks |
| **3** | MVP — end-to-end autonomy (single stack) | Ticket → plan → execute → test → PR, with approvals | …take a real GitHub issue on a Node/TS repo to a reviewable PR, watching it live | 8–10 wks |
| **4** | Beta — breadth & hardening | Multi-provider, multi-Git, Jira/Linear/Slack, MCP client, analytics, RBAC/SSO, security | …run a team's real backlog across GitHub+GitLab with Jira intake and Slack approvals | 10–12 wks |
| **5** | Production / GA | Scale, SLOs, pen test, K8s, DR, docs | …operate 200 concurrent Runs at 99.9% with alerting, backups, and a passed pen test | 8–10 wks |
| **6** | Future | Compounding value | (ongoing) | — |

\* *Indicative for a 4–6 engineer team (2 backend/TS, 1–2 agent/Python, 1 frontend, 1 infra/security shared). Not commitments.*

Detailed task lists, dependencies, acceptance criteria, testing, and DoD per phase are in **[phases/](./phases/)**.

## 2. Dependency graph (phase level)

```
P0 spikes ──► P1 contracts+skeleton ──► P2 core+events+sandbox ──► P3 MVP loop ──► P4 breadth ──► P5 GA
                     │                        │                        │
                     ├── CI/CD from day 1 ────┴── grows each phase ────┘
                     └── golden-task harness seeded in P0, gates from P3 on
```

Hard prerequisites:
- P3 cannot start until the `SandboxProvider`, `ModelRouter`, `VcsProvider`, `AgentRuntime` gRPC, and event pipeline from P1–P2 are real (not stubs).
- P4 multi-provider/Git work is parallelizable once the P3 contracts proved themselves against one concrete impl each.
- P5 pen test needs a feature-frozen P4.

## 3. Workstreams (run in parallel within phases)

| Stream | Owns |
|--------|------|
| **Platform/Core** (TS) | API, tenancy/RBAC, projects, runs, approvals, policy, budgets, BFF, event pipeline, connectors framework |
| **Agent** (Py) | LangGraph roles, context engineering, tools, repo map/embeddings, eval harness, prompt packs |
| **Orchestration** (TS) | Temporal workflows/activities, signals, timers, resume semantics |
| **Providers** | Model Router + LiteLLM, VCS adapters, Tracker/ChatOps connectors, MCP client |
| **Sandbox/Infra** | Firecracker pool, runner protocol, egress control, Compose + Helm, CI/CD, observability stack |
| **Frontend** | Dashboard app, SSE/WS clients, screens, diff/stream components, a11y |
| **Security** (shared) | Threat models, redaction, audit, RBAC tests, red-team suite, pen-test prep |

## 4. Milestones (demo-able)

| M | When | Demo |
|---|------|------|
| **M0** | end P0 | Firecracker VM boots from pool, clones a repo, runs `npm test`, streams output; a LangGraph agent makes one tool call via the broker; a model call routed through LiteLLM with cost recorded |
| **M1** | end P1 | `docker compose up` → dashboard loads, login, create Tenant/Project; a Run row transitions through states driven by a hand-cranked orchestrator; one event reaches the browser over SSE |
| **M2** | end P2 | Start a Run → real sandbox provisioned → Temporal workflow drives the state machine → dashboard shows live (stubbed) steps, timeline, and a working approval gate (raise → decide → resume) |
| **M3 (MVP)** | end P3 | Real GitHub issue on a TS repo → agent plans (human approves) → implements → `test.run` green → AI review → **PR opened** → all visible live; failed-Run path shows a real failure category |
| **M4 (Beta)** | end P4 | Same, but: Anthropic **and** OpenAI with failover; GitHub **and** GitLab; **Jira** intake; **Slack** approval; an **MCP** tool used in a Run; analytics dashboard with real cost/success data; RBAC enforced; SSO login |
| **M5 (GA)** | end P5 | Load demo: 200 concurrent Runs, control-plane rolling deploy mid-load with zero lost Runs; alert fires on an injected stuck Run; restore-from-backup drill; pen-test report with no criticals/highs |

## 5. Risk register

| # | Risk | Impact | Likelihood | Mitigation | Owner |
|---|------|--------|-----------|------------|-------|
| R1 | Agent quality too low → PRs not merge-worthy | Product value | High | Golden-task harness from P0; regression gates; start with narrow "green" ticket classes; Reviewer agent; human plan gate default-on | Agent |
| R2 | Firecracker pool ops complexity / needs bare metal | Delivery, cost | Med-High | gVisor fallback as first-class; `docker` for local; make pool a swappable `SandboxProvider`; spike in P0 | Sandbox/Infra |
| R3 | Runaway cost (loops, big context) | $, trust | Med | Hard budget guards in the orchestrator (not the LLM); reservation before calls; per-Run/Tenant caps; wasted-spend analytics | Orchestration |
| R4 | Prompt injection → unsafe action / exfil | Security | Med | Deterministic control flow; per-step toolset + policy enforced pre-exec; no secrets in context; egress allowlist; injection canaries in CI; outward actions gated | Security |
| R5 | Temporal + LangGraph dual-durability confusion / bugs | Reliability | Med | Clear ownership (Temporal = infra durability, LangGraph = in-agent loop); resume tests from P2; chaos tests | Orchestration |
| R6 | Two runtimes (TS+Py) slow the team | Velocity | Med | Thin gRPC contract; shared schema codegen; one migration owner; spike the boundary in P0 | Platform/Agent |
| R7 | Provider API drift (models, tool-calling, pricing) | Maintenance | High (ongoing) | LiteLLM absorbs most; native adapters only where needed; nightly live-smoke contract tests; catalog-driven pricing | Providers |
| R8 | Real-time fan-out doesn't scale on Node | Perf | Low-Med | SSE stateless + backfill design; load test in P5; Go fan-out gateway allowed if a spike proves need | Frontend/Infra |
| R9 | Scope creep (IDE, auto-merge, deploy) | Timeline | Med | Non-goals in [01](./01-product-vision.md) are contractual; Future items strictly P6 | Product |
| R10 | Self-host security expectations (air-gap, no telemetry) not met | Adoption | Med | Air-gap mode designed in (self-hosted models + Git + no external connectors); telemetry opt-in; pen test | Security |
| R11 | EDAP Workdesk integration brittle (MSSQL/socket auth) | Beta scope | Low-Med | Connector uses only public REST + `/workdesk` socket; contract tests; no Workdesk code changes | Providers |
| R12 | Golden-task suite too small → false confidence | Quality | Med | Mint a golden task from every notable prod failure; target tiers/counts in [17](./17-testing-strategy.md); track variance | Agent |

## 6. Rollout strategy

1. **Dogfood (during P3–P4):** run Praxis against its own repo for chore/test/docs tickets. Every failure → a golden task.
2. **Design partners (P4/Beta):** 2–3 teams, narrow ticket classes, plan+delivery approval forced on, tight budgets, daily review of wasted spend + interventions.
3. **Gated GA (P5):** widen ticket classes per partner as their acceptance rate clears the [01](./01-product-vision.md) targets; enable optional auto-approve for low-risk classes only after 4 weeks of clean data.
4. **Post-GA:** policy presets tuned from aggregate data; connector catalog expansion driven by demand.

## 7. Success criteria to advance each phase

| Advance to | Gate |
|-----------|------|
| P1 | Every P0 spike has a runnable artifact + a written finding (keep/change/kill) |
| P2 | Contracts (`ModelRouter`, `SandboxProvider`, `VcsProvider`, `TrackerProvider`, `EventBus`, `AgentRuntime`) reviewed, versioned v0, contract-test suites exist |
| P3 | M2 demo passes; CI runs unit+contract+integration+golden-smoke green on main |
| P4 | M3 (MVP) demo passes; ≥ 45% autonomous PR acceptance on the chosen green ticket classes across ≥ 30 dogfood Runs; cost/Run ≤ $3 |
| P5 | M4 (Beta) demo passes; design-partner acceptance ≥ 55%; RBAC/SSO/audit complete; security review clean (internal) |
| GA | M5 demo passes; external pen test → 0 criticals/highs; SLOs met in staging for 2 weeks; DR drill passed; docs + runbooks complete |

## 8. Non-goals reminder (do not let these leak into a phase)

No human IDE, no auto-merge (Future, opt-in, off), no deploy/release automation, no model hosting/training, no general RPA, no replacing the task tracker. See [01](./01-product-vision.md) §7.
