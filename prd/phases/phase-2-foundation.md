# Phase 2 — Core Platform (pre-agent)

**Goal:** everything around the agent is real — intake, the Run state machine driven by Temporal, the full event pipeline, approvals with HITL, the sandbox in the loop, and a dashboard that renders live Run detail. The agent activities still return simple/stubbed work; Phase 3 makes them real. Milestone **M2**.

**Exit criteria:** create a Project → start a Run → a real sandbox is provisioned → the Temporal workflow drives states → the dashboard shows Plan/Steps/Activity/Timeline live → a real approval gate (raise → decide in UI → resume) works → cancel tears down the sandbox.

---

## Intake

### P2-CORE-1 — Tracker intake pipeline
- Deps: P1-PROV-2, P1-CORE-6.
- Webhook Ingress: signature verify, dedupe table, normalize → `WorkItemDraft` → `work_item` upsert (idempotent on `(project, connector, externalId)`); polling scheduler fallback; intake filter (label/assignee/keyword) per Project; manual create endpoint + form.
- **AC (US-2.1, FR-INTAKE-1..6):** adding the configured label creates exactly one WorkItem in < 10 s; redelivered webhook → no dup; manual create works; filtered-out tickets create nothing.
- **Testing:** integration: webhook replay ×3 → 1 row; poll vs webhook parity test.
- **DoD:** `work_item.*` events emitted; Work Items screen lists them.

### P2-FE-1 — Work Items screen
- Deps: P2-CORE-1, P1-FE-1.
- List + filters + detail (normalized fields, parsed AC, source link, "Start Run").
- **AC (US-2.1 AC4, US-2.2):** manual-start items sit in `ready`; Start Run creates a Run; needs_info questions render with a "post to ticket" action (action may be stubbed until P3 triage).
- **DoD:** [../12-dashboard-ui-spec.md](../12-dashboard-ui-spec.md) §7 realized.

## Run lifecycle

### P2-ORCH-1 — `RunWorkflow` full state machine
- Deps: P1-ORCH-1, P2-CORE-1.
- Real activities for: `normalize/prepare`, `prep_repo` (calls Sandbox Broker + `BuildRepoMap`), `plan` (calls `RunPlan` — result may be a simple template plan in P2), per-step `execute_step` (stubbed agent), `verify_full` (runs the Project's configured commands in the sandbox — real), `review` (stub verdict), `deliver` (real branch+push+PR via P1-PROV-2, gated).
- Budget guard: reserve/settle via `ModelRouter` + orchestrator-side wall-clock/iteration/tool-call/file counters; soft → Approval, hard → abort with category.
- **AC (FR-EXEC-5, FR-VERIFY-1, FR-DELIVER-1..5):** a Run walks the full path; `verify_full` really runs `npm test` in the sandbox and attaches a report Artifact; `deliver` opens a real PR on `gitea`/GitHub and updating it doesn't duplicate; hard budget breach aborts with `budget_exceeded`.
- **Testing:** integration across the whole sequence with a stub agent; chaos: kill worker in each activity → resume.
- **DoD:** [../05-system-architecture.md](../05-system-architecture.md) §4 steps 1–10 executable end to end (agent output trivial).

### P2-CORE-2 — Runs, Steps, Plan, tool_call, model_call, artifact persistence
- Deps: P1-CORE-4, P2-ORCH-1.
- Entities + repositories + REST ([../13-api-design.md](../13-api-design.md) §2–3): `/runs` (list with filters, get, start, cancel, pause, resume, comment, retry), `/runs/:id/{plan,steps,tool-calls,model-calls,artifacts,events}`.
- Invariants ([../10-database-architecture.md](../10-database-architecture.md) §8) enforced by constraints; `run_event.seq` gap-free via advisory lock.
- **AC:** list filters + cursor pagination work; artifact download returns a short-TTL signed URL scoped to tenant; a Run always pins an `agent_config_version` + `policy` version.
- **Testing:** unit (seq, idempotency), integration (list/detail/BFF), tenant-isolation.
- **DoD:** Dashboard BFF `/bff/runs/:id/detail` assembles the Run detail in one call.

### P2-CORE-3 — Sandbox in the loop
- Deps: P1-SBX-1, P2-ORCH-1.
- Wire Sandbox Broker into `prep_repo`/`execute_step`/`verify_full`; per-Run egress policy pushed from the Project Policy; VCS ephemeral token minted per Run and injected; teardown on any terminal state + on cancel.
- **AC (US-2.5 cancel, FR-EXEC-1,7):** cancel mid-Run → sandbox destroyed within seconds, pushed branch (if any) kept with a note; token revoked; no orphan VMs (leak test).
- **DoD:** System Health shows real sandbox pool metrics.

## Approvals / HITL

### P2-CORE-4 — Approval service + HITL gates
- Deps: P2-ORCH-1, P1-CORE-6.
- `approval` entity; raise → `approval.requested` event (+ `tenant.<id>.approvals` topic) + SLA timer; decide endpoint ([../13-api-design.md](../13-api-design.md) §3) with RBAC (Maintainer+), idempotency, mandatory note for reject/override; on decide → Temporal signal → workflow resumes; on SLA expiry → fail-safe (no action) + flag.
- Gate points wired: plan approval (per Project toggle), risky-tool (from Tool Broker risk tier), budget soft-limit, delivery approval. (Review-block + non-progress gates land in P3 when the agent is real.)
- **AC (US-2.3, US-2.6, FR-APPROVE-1..6):** plan gate pauses the Run; decide in UI → resume; risky-tool gate blocks the exact call and proceeds on approve; SLA expiry → `expired` + Run fails safe; every decision audited.
- **Testing:** integration: raise→SSE→decide→resume; expiry path; RBAC denial (Operator can't decide).
- **DoD:** [../06-agent-architecture.md](../06-agent-architecture.md) §5 gate table implemented for the P2 subset.

### P2-FE-2 — Approvals inbox
- Deps: P2-CORE-4, P1-FE-1.
- Inbox list sorted by SLA urgency; expand → evidence (diff, action payload, step context, cost so far); Approve/Reject/Re-plan with note; live add/remove/decide via the approvals SSE stream.
- **AC (US-3.2, FR-DASH-3):** an approval appears < 1 s after raised; deciding removes it in real time; SLA < 15 m flagged red; expired moves to a resolved section.
- **DoD:** [../12-dashboard-ui-spec.md](../12-dashboard-ui-spec.md) §6 realized.

## Dashboard

### P2-FE-3 — Run detail screen (live)
- Deps: P2-CORE-2, P1-CORE-6.
- Tabs: Plan, Steps, Activity (live event stream), Changes (diff viewer fed by `fs.patch`/`git.commit` events + diff artifact), Verification (streamed check logs + results), Timeline, Logs, Cost, PR. Header actions (pause/comment/cancel via WS). Connection/reconnect UX with seq backfill.
- **AC (US-2.4, FR-DASH-5,9,11):** with a stub agent emitting realistic events, Activity streams tool calls, Changes updates live, Timeline shows step bars + the approval wait gap; forced SSE drop → backfill, no gaps/dupes; **every progress indicator maps to a received event** (Playwright asserts this by intercepting the stream).
- **Testing:** dashboard E2E (Playwright) per [../17-testing-strategy.md](../17-testing-strategy.md) §6.
- **DoD:** [../12-dashboard-ui-spec.md](../12-dashboard-ui-spec.md) §5 + §16 rules enforced in code review.

### P2-FE-4 — Overview (fleet) + System Health
- Deps: P2-CORE-2, P2-CORE-3.
- Fleet counters (from a `fleet.counters` consumer, throttled ≤ 1 s), active-agent cards, recent-events feed, health tiles (sandbox pool, bus lag, model error rate, connector health).
- **AC (US-3.1, FR-DASH-1,8):** counters reflect real Runs within 1 s; health tiles show real metrics; clicking a card opens Run detail.
- **DoD:** [../12-dashboard-ui-spec.md](../12-dashboard-ui-spec.md) §3 + §12 realized.

## Providers / connectors framework

### P2-PROV-1 — Connector framework + EDAP Workdesk tracker connector
- Deps: P1-CORE-1, P2-CORE-1.
- `Connector` lifecycle (install/health/enable-per-project/teardown), secrets via `SecretsProvider`, `connector_event` raw log; implement the **EDAP Workdesk** `TrackerProvider` (REST list + `/workdesk` Socket.io subscribe, normalize task→WorkItem, comment + status write-back).
- **AC (FR-INT-1..2, US-1.2):** install Workdesk connector with a service JWT; health check green; a Workdesk task with the `praxis` tag → WorkItem via socket event < 10 s; `run.delivered` posts a PR-link comment back and transitions the task to "In Review".
- **Testing:** contract suite for `TrackerProvider`; integration against a Workdesk instance or a faithful mock built from its OpenAPI + socket contract.
- **DoD:** no Workdesk code changes; public surface only; [../09-integration-tool-architecture.md](../09-integration-tool-architecture.md) §2 EDAP notes verified.

### P2-CORE-5 — Tool Broker + native tool catalog (sandbox tools)
- Deps: P1-SBX-1, P2-CORE-3.
- Registry; per-call: schema validate → risk-tier resolve (max of default, policy) → Project enablement → scopes → rate limit → dispatch (sandbox tools real: `fs.*`, `code.search`, `shell.exec`, `test.run`, `build.run`, `lint.run`, `git.*`) → record `tool_call` + events → post-process (truncate + artifact, redact, untrusted-wrap).
- **AC (FR-EXEC-3,4, FR-INT-7,8):** each tool executes in the sandbox and streams; a policy-forbidden path write is denied and logged; `git.push` to a protected branch is refused; disabling a tool per Project blocks it mid-Run.
- **Testing:** unit (risk resolution, policy), integration (each tool round-trip), security (path/branch guards).
- **DoD:** control-plane tools (`vcs.*`, `tracker.*`, `slack.*`, `memory.*`) stubbed with the right risk tiers for P3.

## Observability

### P2-INFRA-1 — Tracing, metrics, logs wired
- Deps: P1-INFRA-3.
- OTel SDK in every service; trace context API→Temporal→gRPC→broker→runner; `run` root span; `gen_ai.*` + `praxis.*` attributes; Prometheus metrics ([../15-observability.md](../15-observability.md) §5) for runs/model/sandbox/bus/queues/connectors; structured JSON logs with `trace_id`/`run_id`/`tenant_id`; Grafana Fleet + Run drill-down dashboards shipped.
- **AC (NFR-OBS-1..3):** a Run is one trace spanning all services; logs cross-link by `trace_id`; Fleet dashboard shows live data.
- **DoD:** golden Grafana dashboards committed as JSON.

### P2-INFRA-2 — Cost ledger aggregations
- Deps: P1-PROV-1, P2-CORE-2.
- Materialized views `mv_cost_daily_project/model`, `mv_run_totals`; event-triggered `REFRESH CONCURRENTLY` ≤ 1 min; `/analytics/cost` endpoint.
- **AC (NFR-OBS-4, FR-DASH-12):** Run "Cost" tab shows per-model breakdown within 1 min of a call; every cost figure names provider+model.
- **DoD:** [../15-observability.md](../15-observability.md) §10 satisfied.

## Security

### P2-SEC-1 — Redaction lib + audit coverage + tenant-isolation test suite
- Deps: P1-CORE-5, P1-PROV-1.
- Promote P0 redaction to a package used by `ModelRouter` + the logging layer + artifact writer; a coverage test asserts every mutating service writes an audit row; a dedicated cross-tenant test suite (API + RLS + object storage + events + vectors).
- **AC (NFR-SEC-7, FR-PLAT-4, US-5.3):** no fixture leaks a secret to a provider/log/artifact; audit coverage test green; all cross-tenant probes → 404/deny.
- **DoD:** [../14-security.md](../14-security.md) §8–10 baseline in place.
