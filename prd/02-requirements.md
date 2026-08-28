# 02 — Requirements

IDs are stable references used by user stories ([03](./03-user-stories.md)) and phase plans ([phases/](./phases/)).
`MUST` / `SHOULD` / `MAY` per RFC 2119. Priority: **P0** (MVP), **P1** (Beta), **P2** (GA), **P3** (Future).

---

## A. Functional requirements

### FR-INTAKE — Ticket intake & normalization

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-INTAKE-1 | The system MUST ingest tickets from at least one tracker connector via webhook **and** polling fallback. | P0 |
| FR-INTAKE-2 | Each ticket MUST be normalized to a `WorkItem` with: external id, title, body, labels, assignee, priority, acceptance criteria (parsed if present), attachments, source URL, raw payload. | P0 |
| FR-INTAKE-3 | The system MUST deduplicate: the same external ticket id MUST map to one WorkItem; repeated webhooks update it idempotently. | P0 |
| FR-INTAKE-4 | Operators MUST be able to create a WorkItem manually (paste text / fill form). | P0 |
| FR-INTAKE-5 | The system MUST support intake filters per Project (label allowlist, assignee = bot, magic keyword) so only opted-in tickets start Runs. | P0 |
| FR-INTAKE-6 | A WorkItem MAY be auto-started or require an operator to click "Start Run", configurable per Project. | P0 |
| FR-INTAKE-7 | The system SHOULD post a status comment back to the source ticket at plan / PR-opened / failed. | P1 |
| FR-INTAKE-8 | The system SHOULD support batch intake (select N tickets, enqueue). | P1 |

### FR-TRIAGE — Triage & readiness

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-TRIAGE-1 | An agent MUST classify each WorkItem: type (feature/bug/chore/refactor/test/docs), estimated size (S/M/L/XL), and a readiness verdict (`ready` / `needs_info` / `not_suitable`). | P0 |
| FR-TRIAGE-2 | `needs_info` MUST produce a specific question list; the system SHOULD post it to the source ticket and pause. | P1 |
| FR-TRIAGE-3 | Triage MUST route the WorkItem to an Agent config + Project based on rules (repo path, label, size). | P0 |
| FR-TRIAGE-4 | The system MUST reject (with reason) items above a configurable size/risk threshold. | P0 |

### FR-PLAN — Planning

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-PLAN-1 | The Planner agent MUST inspect the target repository (repo map + targeted reads + code search) before proposing changes. | P0 |
| FR-PLAN-2 | The Plan MUST contain: ordered Steps, per-Step rationale, files likely touched, test strategy, risk notes, and rollback notes. | P0 |
| FR-PLAN-3 | The Plan MUST be persisted, versioned, and rendered in the dashboard. | P0 |
| FR-PLAN-4 | The system MUST support a per-Project toggle: plan requires human approval before execution (default ON for Beta). | P0 |
| FR-PLAN-5 | A Maintainer MUST be able to edit/annotate the Plan or request a re-plan with feedback. | P1 |
| FR-PLAN-6 | Re-plan MUST create Plan v(n+1) and keep prior versions for audit. | P1 |

### FR-EXEC — Execution

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-EXEC-1 | Each Run MUST get a fresh, isolated sandbox workspace with the repo checked out at the target base branch. | P0 |
| FR-EXEC-2 | The agent MUST create a working branch named by a configurable template (default `praxis/<tracker-key>-<slug>`). | P0 |
| FR-EXEC-3 | The agent MUST have tools for: read file, write/patch file, list dir, code search (ripgrep + semantic), run shell command, run tests, git status/diff/add/commit, and web fetch/search (allowlisted). | P0 |
| FR-EXEC-4 | Every tool call MUST be recorded with inputs, outputs (truncated + linked full), duration, and result status. | P0 |
| FR-EXEC-5 | The execute→test→fix loop MUST be bounded by: max iterations, max wall-clock, max tokens, max USD, max tool calls, max files changed. Hitting a **soft** bound raises an Approval; a **hard** bound aborts. | P0 |
| FR-EXEC-6 | The agent MUST NOT perform an action classified "risky" (see FR-APPROVE) without an approval. | P0 |
| FR-EXEC-7 | Shell execution MUST run inside the sandbox only; network egress MUST follow the Project's egress policy (default: package registries + Git host + model gateway only). | P0 |
| FR-EXEC-8 | The system MUST detect non-progress (repeated identical tool calls, oscillating diffs, no test-delta over K iterations) and pause the Run for review. | P1 |
| FR-EXEC-9 | An operator MUST be able to pause, resume, cancel, or inject a message into a live Run. | P0 |
| FR-EXEC-10 | The system SHOULD support multiple cooperating agents per Run (e.g., Coder + Reviewer) with a defined handoff protocol. | P1 |
| FR-EXEC-11 | The agent SHOULD be able to consult Project Memory (past Runs, repo conventions) and write back learned facts. | P1 |

### FR-VERIFY — Verification

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-VERIFY-1 | The system MUST run a configurable verification pipeline per Project: build, lint, unit, integration, E2E — each optional, each with pass/fail + logs captured as Artifacts. | P0 (build+unit), P1 (integration+E2E) |
| FR-VERIFY-2 | E2E MUST support spinning up dependent services via a Project-supplied compose file inside the sandbox. | P1 |
| FR-VERIFY-3 | Verification results MUST be attached to the Run and surfaced in the PR body. | P0 |
| FR-VERIFY-4 | A failing required check MUST feed back into the fix loop (bounded by FR-EXEC-5). | P0 |
| FR-VERIFY-5 | The system SHOULD compute and report test coverage delta. | P2 |

### FR-REVIEW — AI self-review

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-REVIEW-1 | A distinct Reviewer agent MUST evaluate the final diff against the WorkItem's acceptance criteria and produce a structured verdict (pass/concerns/block) with itemized findings. | P0 |
| FR-REVIEW-2 | The review MUST check for: leftover debug code, secrets, unrelated changes, missing tests, and obvious security issues. | P0 |
| FR-REVIEW-3 | A `block` verdict MUST return the Run to the fix loop or to human review (configurable). | P0 |
| FR-REVIEW-4 | Review findings MUST be posted into the PR/MR description or as review comments. | P1 |

### FR-DELIVER — Delivery

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-DELIVER-1 | The system MUST commit with a conventional-commit message (agent-generated, templated) and push the branch to the Git provider. | P0 |
| FR-DELIVER-2 | The system MUST open a PR/MR with: summary, mapped acceptance criteria checklist, changes list, verification results, AI-review summary, cost/time, and a link back to the Praxis Run. | P0 |
| FR-DELIVER-3 | Delivery MUST support a per-Project human approval gate before push/PR (default ON for Beta). | P0 |
| FR-DELIVER-4 | The system MUST NOT merge, force-push, or modify protected branches. | P0 |
| FR-DELIVER-5 | If a PR already exists for the branch, the system MUST update it, not duplicate. | P0 |
| FR-DELIVER-6 | The system SHOULD link the PR to the source ticket per tracker conventions. | P1 |
| FR-DELIVER-7 | The system SHOULD respond to PR review comments with follow-up commits (opt-in "iterate on review" mode). | P2 |

### FR-APPROVE — Human approval & policy

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-APPROVE-1 | The system MUST classify actions into risk tiers: **auto** (read, search, branch, run tests, commit locally), **notify** (write file, install dep, push), **approve** (open PR, post to external service, delete files > threshold, edit CI config, network egress outside allowlist), **forbidden** (merge, force-push, prod deploy, secret exfiltration, modify `.praxis` policy). | P0 |
| FR-APPROVE-2 | Risk tiers MUST be configurable per Project via Policy, within platform-enforced maximums. | P0 |
| FR-APPROVE-3 | An `approve`-tier action MUST block the Run, create an Approval with evidence, notify approvers (dashboard + ChatOps + email), and resume only on an authorized decision. | P0 |
| FR-APPROVE-4 | Approvals MUST have a configurable SLA; on expiry the Run fails safe (no action) and is flagged. | P0 |
| FR-APPROVE-5 | Every approval decision MUST be in the audit log with actor, time, and rationale. | P0 |
| FR-APPROVE-6 | Budget soft-limit breaches MUST raise an Approval ("continue with +X budget?"). | P0 |
| FR-APPROVE-7 | The system SHOULD support standing approvals ("auto-approve dependency bumps in repo X for label Y"). | P2 |

### FR-AI — AI provider abstraction

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-AI-1 | All model calls MUST go through the Model Gateway; no service calls a provider SDK directly. | P0 |
| FR-AI-2 | The gateway MUST support OpenAI, Anthropic, and Google Gemini at MVP; the adapter contract MUST allow adding a provider without core changes. | P0 |
| FR-AI-3 | The gateway MUST support "Codex"-class / code-specialized models and self-hosted OpenAI-compatible endpoints (vLLM, Ollama, TGI). | P1 |
| FR-AI-4 | The gateway MUST support per-Agent model binding, per-role defaults, and per-Tenant overrides. | P0 |
| FR-AI-5 | The gateway MUST support automatic failover and retry across providers/models on 429/5xx/timeout, with a configurable policy. | P0 |
| FR-AI-6 | The gateway MUST meter tokens and cost per call, attributed to Run / Step / Agent / Tenant. | P0 |
| FR-AI-7 | The gateway MUST support streaming responses and tool/function calling normalized across providers. | P0 |
| FR-AI-8 | The gateway MUST support prompt/response redaction and a configurable "no-train" / data-retention header set per provider. | P0 |
| FR-AI-9 | The gateway SHOULD support response caching (exact + semantic) and prompt-cache hints. | P1 |
| FR-AI-10 | The gateway SHOULD expose a model catalog with capabilities (context window, tools, vision, price) for routing decisions. | P1 |

### FR-GIT — Git provider abstraction

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-GIT-1 | A `VcsProvider` contract MUST cover: clone/fetch, list branches, create branch, get default/protected branches, read file at ref, commit, push, open/update PR-MR, add PR comment, get PR status/checks, list repos. | P0 |
| FR-GIT-2 | GitHub and GitLab adapters MUST exist at MVP; Bitbucket at Beta; a generic Git (SSH/HTTPS remote, no PR API) adapter at Beta. | P0 / P1 |
| FR-GIT-3 | Auth MUST support GitHub App / GitLab group access token / Bitbucket app password / SSH deploy key, stored in the secrets manager. | P0 |
| FR-GIT-4 | The system MUST ingest Git webhooks (push, PR events, comments) normalized to platform events. | P1 |
| FR-GIT-5 | The system MUST respect protected-branch rules reported by the provider and never bypass them. | P0 |
| FR-GIT-6 | Generic Git adapter MUST degrade gracefully: no PR API → produce a patch Artifact + push branch + instructions. | P1 |

### FR-INT — Integration & tool system

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-INT-1 | Connectors MUST be installable per Tenant with scoped OAuth/token auth and a health check. | P0 |
| FR-INT-2 | The system MUST provide connector contracts for: Tracker, VCS, ChatOps, CI, KV/Docs, and MCP-server. | P0 (Tracker/VCS/ChatOps), P1 (CI/KV) |
| FR-INT-3 | The system MUST act as an **MCP client**: connect to external MCP servers (stdio + streamable HTTP), enumerate tools/resources, and expose them to agents under Policy. | P1 |
| FR-INT-4 | The system SHOULD expose selected platform capabilities as an **MCP server** (read Run status, list WorkItems, start Run). | P2 |
| FR-INT-5 | Tracker connectors at MVP: GitHub Issues + EDAP Workdesk. Beta: Jira, Linear. | P0 / P1 |
| FR-INT-6 | ChatOps connector at MVP: Slack (approvals, status, `/praxis` command). Beta: MS Teams, Discord. | P0 / P1 |
| FR-INT-7 | Each Tool MUST declare a JSON schema, a risk tier, a permission scope, and idempotency semantics. | P0 |
| FR-INT-8 | A tenant admin MUST be able to enable/disable individual Tools per Project. | P0 |
| FR-INT-9 | Third parties SHOULD be able to add a connector as an out-of-tree package implementing the contract + passing the contract test suite. | P2 |

### FR-DASH — Dashboard

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-DASH-1 | A fleet view MUST show, updating in real time: active agents, and Runs by state (queued/running/awaiting-approval/succeeded/failed). | P0 |
| FR-DASH-2 | A queue view MUST list Runs with filters (Project, state, agent, model, date) and per-Run key stats (duration, cost, tokens, files changed). | P0 |
| FR-DASH-3 | An approvals inbox MUST list open Approvals with evidence and one-click approve/reject + comment. | P0 |
| FR-DASH-4 | A live agent-activity panel MUST stream the current Step, tool calls, and token stream for a running Run. | P0 |
| FR-DASH-5 | A Run detail screen MUST show: Plan → Steps → live progress → logs → tool calls → files changed (diff) → verification results → AI review → PR link → final result, each drillable. | P0 |
| FR-DASH-6 | An execution timeline MUST visualize Step start/end, approvals, and wait gaps on a time axis. | P1 |
| FR-DASH-7 | Analytics screens MUST show historical success/failure rate, Run duration distribution, token/cost trends, cost by Project/model, human-intervention rate, and failure taxonomy. | P1 |
| FR-DASH-8 | A system-health panel MUST show queue depth, worker/sandbox pool utilization, event-bus lag, model-gateway error rates, and connector health. | P1 |
| FR-DASH-9 | Real-time updates MUST be event-driven (SSE/WebSocket) from the backend; the frontend MUST NOT poll-and-fake or synthesize progress. | P0 |
| FR-DASH-10 | The dashboard MUST support deep links to any Run/Step/Approval and be keyboard-navigable. | P1 |
| FR-DASH-11 | Repository/branch/PR activity for a Run MUST be visible (branch name, commits, PR state, check results). | P0 |
| FR-DASH-12 | Every screen showing costs MUST show the AI provider + model used per call. | P0 |

### FR-PLATFORM — Platform, auth, ops

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-PLAT-1 | Multi-tenant: all data MUST be scoped by Tenant Workspace; cross-tenant access MUST be impossible via the API. | P0 |
| FR-PLAT-2 | AuthN MUST support email+password and OIDC/SAML SSO; sessions via short-lived JWT + refresh. | P0 (local), P1 (SSO) |
| FR-PLAT-3 | RBAC MUST enforce the role matrix in [14](./14-security.md) on every endpoint and event subscription. | P0 |
| FR-PLAT-4 | An append-only audit log MUST record every state transition, approval, config change, secret access, and tool invocation with actor + timestamp + before/after. | P0 |
| FR-PLAT-5 | Secrets MUST be stored in the secrets manager, never in Postgres or logs; sandbox secret injection MUST be scoped and time-boxed. | P0 |
| FR-PLAT-6 | Long-running work MUST use the durable orchestrator + queues; no long work in an HTTP request. | P0 |
| FR-PLAT-7 | The full platform MUST run via `docker compose up` including seed data and a demo Project. | P0 |
| FR-PLAT-8 | All services MUST expose `/healthz`, `/readyz`, and OpenTelemetry traces/metrics. | P0 |
| FR-PLAT-9 | Config MUST be 12-factor (env + mounted secrets); no baked-in environment specifics. | P0 |
| FR-PLAT-10 | Data-retention policies MUST be configurable per Tenant (logs, artifacts, model I/O). | P1 |
| FR-PLAT-11 | The platform MUST provide a REST API + generated OpenAPI + at least a TypeScript and Python client. | P1 |

---

## B. Non-functional requirements

### NFR-PERF — Performance & scale

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-PERF-1 | Concurrent Runs per single-node dev deploy | ≥ 5 |
| NFR-PERF-2 | Concurrent Runs per production reference deploy | ≥ 200, horizontally scalable |
| NFR-PERF-3 | Dashboard event delivery latency (backend emit → browser render) | p95 < 750 ms |
| NFR-PERF-4 | API read latency (list/detail) | p95 < 300 ms |
| NFR-PERF-5 | Sandbox cold start | p95 < 8 s (microVM), < 3 s (warm pool) |
| NFR-PERF-6 | Orchestrator can resume in-flight Runs after full control-plane restart | 100%, < 60 s |
| NFR-PERF-7 | Event bus sustained throughput | ≥ 10k events/s reference deploy |

### NFR-REL — Reliability

| ID | Requirement |
|----|-------------|
| NFR-REL-1 | No Run may be silently lost: a crashed worker's Run resumes or is marked failed with reason within 2 min. |
| NFR-REL-2 | All external calls (model, Git, tracker) use timeouts, bounded retries with jitter, and circuit breakers. |
| NFR-REL-3 | Exactly-once side effects for delivery actions (push/PR) via idempotency keys. |
| NFR-REL-4 | Graceful degradation: if the model gateway's primary provider is down, Runs continue on failover; if all providers down, Runs pause (not fail). |
| NFR-REL-5 | Backups: Postgres PITR; object storage versioned; restore drill documented and tested each phase. |

### NFR-SEC — Security (full detail in [14](./14-security.md))

| ID | Requirement |
|----|-------------|
| NFR-SEC-1 | Agent-executed code runs with no ambient credentials to cloud, control plane, or other tenants. |
| NFR-SEC-2 | All inter-service traffic authenticated (mTLS or signed tokens); all external traffic TLS 1.2+. |
| NFR-SEC-3 | Secrets encrypted at rest (KMS-backed) and in transit; access is audited and least-privilege. |
| NFR-SEC-4 | Sandbox egress default-deny with per-Project allowlist; no lateral network access. |
| NFR-SEC-5 | Prompt-injection defenses: tool-output sanitization, "untrusted content" tagging, tool-call allowlist per Step, no secret-bearing env in agent context. |
| NFR-SEC-6 | Dependency and container image scanning in CI; SBOM produced per release. |
| NFR-SEC-7 | PII/secret scrubbing on logs and model I/O before persistence. |
| NFR-SEC-8 | Pass an external pen test before GA; findings triaged to zero criticals/highs. |

### NFR-OBS — Observability (full detail in [15](./15-observability.md))

| ID | Requirement |
|----|-------------|
| NFR-OBS-1 | Every Run is one distributed trace; every model call is a `gen_ai.*` span; every tool call is a child span. |
| NFR-OBS-2 | Structured JSON logs with `trace_id`, `run_id`, `tenant_id` on every line. |
| NFR-OBS-3 | RED + USE metrics for every service; golden dashboards shipped. |
| NFR-OBS-4 | Cost and token dashboards updated within 1 min of a call. |
| NFR-OBS-5 | Alert rules for: stuck Runs, approval SLA breach, budget burn rate, queue backlog, provider error spike, sandbox pool exhaustion. |

### NFR-MAINT — Maintainability & portability

| ID | Requirement |
|----|-------------|
| NFR-MAINT-1 | Provider adapters / connectors / tools are separate packages with published contracts and a contract test suite; core has zero concrete-provider imports. |
| NFR-MAINT-2 | DB schema changes via versioned, reversible migrations; no manual prod DDL. |
| NFR-MAINT-3 | Every merge runs unit + contract + a fast golden-task subset in CI. |
| NFR-MAINT-4 | Runs on Linux/amd64 and arm64; no OS-specific assumptions outside the sandbox image. |
| NFR-MAINT-5 | Same container images run in Compose and Kubernetes; only config differs. |

### NFR-UX

| ID | Requirement |
|----|-------------|
| NFR-UX-1 | Dashboard usable on a 1280px-wide screen; primary flows work down to 1024px. |
| NFR-UX-2 | Light + dark themes; WCAG 2.1 AA for core flows. |
| NFR-UX-3 | Any list/stream renders first paint < 1.5 s on a mid-tier laptop with 1k Runs in history. |
| NFR-UX-4 | Live views must indicate connection state and auto-reconnect without a manual refresh. |

### NFR-COMPLIANCE

| ID | Requirement |
|----|-------------|
| NFR-COMP-1 | Data-residency: all state in customer-controlled infra for self-host; no telemetry leaves without opt-in. |
| NFR-COMP-2 | Configurable retention + hard delete for Tenant data on request. |
| NFR-COMP-3 | Audit log exportable (JSON/CSV) and tamper-evident (hash-chained). |
| NFR-COMP-4 | Roadmap to SOC 2 Type II controls documented (GA+). |

---

## C. Constraints & assumptions

- **C-1** First-party code is TypeScript or Python only (stakeholder directive).
- **C-2** The existing EDAP Workdesk (MSSQL/NestJS/Angular) is *integrated*, not modified. Praxis owns PostgreSQL for its own state.
- **C-3** Customers supply their own provider API keys / endpoints and Git/tracker credentials.
- **C-4** MVP delivery boundary is "PR/MR opened"; no deployment automation.
- **C-5** Internet access is required for hosted providers; an air-gapped mode requires self-hosted model endpoints + self-hosted Git + no external connectors.
- **A-1** Target repos are mainstream stacks with a runnable test command (Node, Python, .NET, Java, Go). Exotic build systems are best-effort.
- **A-2** Tickets routed to Praxis are pre-filtered by humans/rules to be "agent-suitable" in v1; broad auto-triage of an entire backlog is P2+.
