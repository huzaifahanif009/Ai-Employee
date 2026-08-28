# 03 — User Stories

Format: `As a <role>, I want <capability>, so that <outcome>.` Each story lists acceptance criteria (AC) and the requirements it exercises. Epics group stories; epic order roughly tracks the roadmap.

Personas (from [01](./01-product-vision.md)): **DevEx** (platform/DevEx engineer & operator), **Lead** (team lead/EM), **Dev** (individual engineer), **Mgr** (eng manager/director), **Sec** (security/compliance).

---

## Epic 1 — Connect the platform

### US-1.1 — Connect a Git provider
**As** DevEx, **I want** to connect a GitHub/GitLab org, **so that** agents can branch and open PRs in our repos.
- AC1: I choose a provider, complete OAuth/App install (or paste a group token / deploy key), and see a green health check.
- AC2: I can select which repositories are in scope; others are invisible to agents.
- AC3: Credentials are stored in the secrets manager; the raw token is never shown again or logged.
- AC4: Revoking the connection immediately blocks all VCS tool calls for its Projects.
- Requirements: FR-GIT-1..3, FR-INT-1, FR-PLAT-5, NFR-SEC-3.

### US-1.2 — Connect a task tracker
**As** DevEx, **I want** to connect Jira / Linear / GitHub Issues / EDAP Workdesk, **so that** tickets flow in automatically.
- AC1: After auth, I pick projects/boards and an intake filter (label, assignee, keyword).
- AC2: A test webhook delivery shows up in an "integration events" log within seconds.
- AC3: Polling fallback runs on a configurable interval if webhooks are unavailable.
- AC4: Disabling the connector stops new WorkItems but keeps history.
- Requirements: FR-INTAKE-1..5, FR-INT-1..2, FR-INT-5.

### US-1.3 — Configure AI providers
**As** DevEx, **I want** to add OpenAI, Anthropic, and Gemini keys (or a self-hosted endpoint), **so that** agents have models and we control spend.
- AC1: I add a credential per provider and run a "test call" that returns model + latency + token cost.
- AC2: I set default models per agent role (Planner/Coder/Reviewer) and a monthly Tenant budget.
- AC3: I define a failover chain (e.g., Anthropic → OpenAI → self-hosted).
- AC4: Keys are write-only in the UI; usage is attributed per Project in analytics.
- Requirements: FR-AI-1..6, FR-AI-8, FR-PLAT-5.

### US-1.4 — Create a Project
**As** Lead, **I want** to bind a repo + tracker source + agent config + policy into a Project, **so that** work is routed and governed consistently.
- AC1: I select one repo, one or more tracker sources, a base branch, and a verification pipeline (build/test commands).
- AC2: I choose policy presets (Conservative / Balanced / Autonomous) and can override individual rules within platform maximums.
- AC3: I set per-Run budgets (tokens/USD/time/iterations).
- AC4: Saving runs a dry-run readiness check (repo clonable, test command detected, model reachable).
- Requirements: FR-TRIAGE-3, FR-APPROVE-2, FR-VERIFY-1, FR-PLAT-9, FR-GIT-1.

---

## Epic 2 — Run a task end to end

### US-2.1 — Auto-intake a ticket
**As** Lead, **I want** a labeled ticket to become a WorkItem automatically, **so that** I don't shepherd every task.
- AC1: Adding the configured label to a ticket creates exactly one WorkItem within 10 s (webhook) or one poll interval.
- AC2: The WorkItem shows normalized title/body/AC/attachments and a link to the source.
- AC3: Re-delivering the webhook does not create a duplicate.
- AC4: If intake is "manual start", the WorkItem sits in `ready` until someone clicks Start.
- Requirements: FR-INTAKE-1..6.

### US-2.2 — Triage and readiness
**As** Lead, **I want** the platform to tell me if a ticket is agent-ready, **so that** I don't waste a Run on an under-specified task.
- AC1: Triage outputs type, size estimate, and `ready` / `needs_info` / `not_suitable` with reasoning.
- AC2: `needs_info` lists concrete questions and (if enabled) posts them to the source ticket, pausing the WorkItem.
- AC3: `not_suitable` closes the WorkItem with a reason visible in the dashboard.
- Requirements: FR-TRIAGE-1..4, FR-INTAKE-7.

### US-2.3 — Review and approve a plan
**As** Maintainer, **I want** to see the agent's plan before it writes code, **so that** I can catch a wrong approach early.
- AC1: The Run pauses in `awaiting_plan_approval`; I get a dashboard + Slack notification.
- AC2: The plan shows ordered steps, files likely touched, test strategy, and risks.
- AC3: I can Approve, Reject (with reason → Run fails), or Request Re-plan (with feedback → Plan v2).
- AC4: My decision and rationale are in the audit log.
- Requirements: FR-PLAN-2..6, FR-APPROVE-3, FR-APPROVE-5.

### US-2.4 — Watch a Run live
**As** Dev, **I want** to watch the agent work in real time, **so that** I trust the output and can intervene.
- AC1: The Run detail screen streams: current Step, each tool call (name, args, result), and the model token stream.
- AC2: Files-changed updates as the agent edits; I can open a live diff.
- AC3: Verification steps stream their logs.
- AC4: Updates arrive via SSE/WebSocket with < 750 ms p95 latency; a dropped connection auto-reconnects and backfills.
- AC5: Nothing on screen is synthesized — every progress indicator maps to a backend event.
- Requirements: FR-DASH-4..5, FR-DASH-9, FR-EXEC-4, NFR-PERF-3, NFR-UX-4.

### US-2.5 — Intervene in a Run
**As** Dev, **I want** to pause, comment, or cancel a running agent, **so that** I can redirect it without starting over.
- AC1: Pause halts after the current tool call; state is preserved; Resume continues.
- AC2: A comment is injected into the agent's next turn as a user message.
- AC3: Cancel tears down the sandbox, marks the Run `cancelled`, and leaves any pushed branch intact with a note.
- Requirements: FR-EXEC-9, FR-PLAT-4.

### US-2.6 — Approve a risky action
**As** Maintainer, **I want** to be asked before the agent opens a PR or calls an external service, **so that** nothing outward-facing happens without a human.
- AC1: The Run blocks; an Approval appears in the inbox with the exact action + payload preview + diff.
- AC2: One-click Approve/Reject with an optional comment; Approve resumes within seconds.
- AC3: No decision before the SLA → Run fails safe (action not taken) and is flagged.
- Requirements: FR-APPROVE-1..5, FR-DASH-3.

### US-2.7 — Get a reviewable PR
**As** Dev, **I want** a well-formed PR I can review quickly, **so that** merging is low-risk.
- AC1: PR body has summary, AC checklist mapped to changes, file list, verification results, AI-review summary, cost/time, and a Run backlink.
- AC2: The branch follows the naming template; commits use conventional-commit messages.
- AC3: If I comment on the PR and "iterate on review" is enabled, the agent pushes follow-up commits addressing comments.
- AC4: The platform never merges; the merge button is mine.
- Requirements: FR-DELIVER-1..7, FR-REVIEW-4.

### US-2.8 — Handle a failed Run
**As** DevEx, **I want** a failed Run to explain itself, **so that** I can fix the setup or retry.
- AC1: The Run shows a failure category (e.g., `tests_never_passed`, `budget_exceeded`, `provider_unavailable`, `non_progress`, `policy_block`) and the last useful state.
- AC2: I can retry from scratch or resume from the last good Step.
- AC3: All logs, tool calls, and partial diff remain available.
- Requirements: FR-EXEC-5, FR-EXEC-8, NFR-REL-1, FR-DASH-5.

---

## Epic 3 — Operate the fleet

### US-3.1 — Fleet overview
**As** DevEx, **I want** a single screen of everything running, **so that** I know the platform's state at a glance.
- AC1: Live counts of Runs by state, active agents, open approvals, and queue depth.
- AC2: A stream of recent notable events (Run started/finished, approval raised, provider error).
- AC3: System health tiles: sandbox pool utilization, event-bus lag, model-gateway error rate, connector health.
- Requirements: FR-DASH-1, FR-DASH-8, NFR-OBS-3.

### US-3.2 — Approvals inbox
**As** Maintainer, **I want** all pending approvals in one queue, **so that** I unblock work fast.
- AC1: Sorted by SLA urgency; each row shows Project, Run, action, requester-agent, age.
- AC2: Filter by Project/type; bulk-approve same-type low-risk items (if policy allows).
- Requirements: FR-DASH-3, FR-APPROVE-3, FR-APPROVE-7.

### US-3.3 — Budgets and cost governance
**As** Mgr, **I want** to cap and see spend, **so that** autonomous work stays within budget.
- AC1: Per-Tenant and per-Project monthly caps; a burn-rate chart with projection.
- AC2: At 80% a warning; at 100% new Runs require approval or are blocked (configurable).
- AC3: Cost breakdown by Project, model, and outcome (successful vs wasted spend).
- Requirements: FR-AI-6, FR-APPROVE-6, FR-DASH-7, FR-DASH-12.

### US-3.4 — Historical analytics
**As** Mgr, **I want** trends over weeks, **so that** I can judge ROI and where agents struggle.
- AC1: Success rate, Run-duration distribution, human-intervention rate, and failure taxonomy over a selectable window.
- AC2: "Tasks delivered" and an estimate of human-hours saved (configurable per-task baseline).
- AC3: Drill from any chart to the underlying Runs.
- Requirements: FR-DASH-7, NFR-OBS-4.

### US-3.5 — Tune agents and policies
**As** DevEx, **I want** to adjust prompts, toolsets, models, and policies per Project, **so that** I can improve results safely.
- AC1: Editing an Agent config is versioned; I can diff and roll back.
- AC2: A "shadow run" mode executes a new config against a golden task set without delivering.
- AC3: Policy changes are audited and cannot exceed platform maximums.
- Requirements: FR-INT-7..8, FR-APPROVE-2, NFR-MAINT-1, FR-PLAT-4.

---

## Epic 4 — Extend the platform

### US-4.1 — Add an MCP server
**As** DevEx, **I want** to register an external MCP server, **so that** agents gain new tools without a code change.
- AC1: I provide the MCP endpoint + auth (OAuth 2.1 or token); the platform lists its tools/resources.
- AC2: I assign specific MCP tools to Projects and set their risk tier.
- AC3: MCP tool calls appear in the Run's tool-call log like native tools.
- Requirements: FR-INT-3, FR-INT-7, FR-DASH-4.

### US-4.2 — Add a custom connector
**As** a third-party developer, **I want** to implement the Tracker contract for our in-house system, **so that** Praxis ingests our tickets.
- AC1: A documented contract + a contract test suite I can run locally.
- AC2: Dropping the package in and configuring it needs no core rebuild.
- AC3: The connector shows in the catalog with its own health check.
- Requirements: FR-INT-2, FR-INT-9, NFR-MAINT-1.

### US-4.3 — ChatOps approvals
**As** Maintainer, **I want** to approve from Slack, **so that** I don't need the dashboard open.
- AC1: An approval posts to a configured channel with action detail and Approve/Reject buttons.
- AC2: Clicking resolves the Approval and records me as the actor (identity mapped to a platform user).
- AC3: `/praxis status <run>` and `/praxis start <ticket>` work with RBAC checks.
- Requirements: FR-INT-6, FR-APPROVE-3.

---

## Epic 5 — Security & compliance

### US-5.1 — Least-privilege sandbox
**As** Sec, **I want** proof that agent code can't reach our cloud or other tenants, **so that** I can approve the platform.
- AC1: The sandbox has no cloud metadata access, no control-plane network route, and only allowlisted egress.
- AC2: Secrets are injected scoped to the Run and revoked at teardown.
- AC3: A red-team test doc shows attempted escape/exfil scenarios and their containment.
- Requirements: NFR-SEC-1, NFR-SEC-4, NFR-SEC-5, FR-EXEC-7.

### US-5.2 — Audit everything
**As** Sec, **I want** a tamper-evident audit trail, **so that** I can answer "who/what/when" for any action.
- AC1: Every state change, approval, config edit, secret access, and tool call is recorded with actor, time, and before/after.
- AC2: The log is append-only, hash-chained, and exportable.
- AC3: I can filter by actor, Run, Project, and action type.
- Requirements: FR-PLAT-4, NFR-COMP-3.

### US-5.3 — RBAC enforcement
**As** DevEx, **I want** roles enforced everywhere, **so that** a Viewer can't start Runs or read secrets.
- AC1: Every API route and event subscription checks role + Tenant scope.
- AC2: A cross-tenant object id returns 404, not 403 (no existence leak).
- AC3: Role changes take effect on the next request without re-login beyond token refresh.
- Requirements: FR-PLAT-1, FR-PLAT-3.

### US-5.4 — Data retention & deletion
**As** Sec, **I want** configurable retention and hard delete, **so that** we meet our data policy.
- AC1: Per-Tenant retention windows for logs, artifacts, and model I/O.
- AC2: A delete request purges Tenant data from Postgres, object storage, vector store, and traces within the SLA, with a completion record.
- Requirements: FR-PLAT-10, NFR-COMP-1..2.

---

## Epic 6 — Self-host & operate

### US-6.1 — Local bring-up
**As** DevEx, **I want** `docker compose up` to give me a working platform with a demo, **so that** I can evaluate it in under 30 minutes.
- AC1: One command starts API, orchestrator, workers, sandbox pool, DB, event bus, dashboard, and a stub tracker + local Git server.
- AC2: A seeded demo Project runs a sample WorkItem to a PR on the local Git server.
- AC3: A single `.env` covers all required config; missing values fail fast with a clear message.
- Requirements: FR-PLAT-7, FR-PLAT-9, NFR-MAINT-5.

### US-6.2 — Kubernetes deploy
**As** DevEx, **I want** a Helm chart / manifests, **so that** I can run Praxis in our cluster.
- AC1: The same images from Compose deploy to K8s; only config differs.
- AC2: Control-plane services are stateless with HPA; state is external (managed PG, object store, secrets).
- AC3: Health/readiness probes, PodDisruptionBudgets, and resource requests/limits are set.
- Requirements: NFR-MAINT-5, FR-PLAT-8, NFR-PERF-2.

### US-6.3 — Upgrade safely
**As** DevEx, **I want** zero-downtime upgrades with reversible migrations, **so that** updating is low-risk.
- AC1: Rolling deploy keeps the API available; in-flight Runs resume post-deploy.
- AC2: Migrations are forward/backward compatible for one minor version (expand/contract).
- AC3: A documented rollback path for each release.
- Requirements: NFR-PERF-6, NFR-MAINT-2, NFR-REL-1.
