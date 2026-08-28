# Phase 3 — MVP: End-to-End Autonomy (single stack)

**Goal:** the agent activities become real. A genuine GitHub issue on a Node/TS repo goes ticket → triage → plan (human-approved) → implement → tests green → AI review → **PR opened**, fully observable live, with real failure handling. One provider (Anthropic *or* OpenAI), one Git host (GitHub), one language (TS/Node), one tracker (GitHub Issues) + EDAP Workdesk. Milestone **M3**.

**Exit criteria (advance to P4):** M3 demo passes; CI runs unit+contract+integration+golden-`smoke`+injection-canaries green on `main`; ≥ 45% autonomous PR acceptance on the chosen "green" ticket classes across ≥ 30 dogfood Runs; cost/Run ≤ $3; median small-task wall-clock ≤ 25 min.

---

## Agent — real roles

### P3-AGENT-1 — Triager
- Deps: P2 (all), P1-AGENT-1.
- Real LangGraph graph: classify type/size, readiness verdict (`ready`/`needs_info`/`not_suitable`) with reasoning + question list; routing suggestion (project/agent config).
- **AC (FR-TRIAGE-1..4, US-2.2):** verdict + reasoning persisted + `work_item.triaged` event; `needs_info` posts questions to the source ticket (GitHub + Workdesk) and pauses the WorkItem; `not_suitable` closes with reason; over-threshold size auto-rejected.
- **Testing:** golden tasks tagged with expected verdicts; precision/recall tracked.
- **DoD:** [../06-agent-architecture.md](../06-agent-architecture.md) §1 Triager row implemented.

### P3-AGENT-2 — Planner + context engineering
- Deps: P3-AGENT-1, P2-CORE-5.
- Repo map (tree-sitter symbol index + manifest summary + `AGENTS.md`/`.praxis/agent.md` injection), `code.search` (lexical + semantic via pgvector), targeted `fs.read`; produce a structured `Plan` (ordered steps, per-step rationale + files + risk tier, test strategy, risk/rollback notes) validated against a JSON Schema with bounded reprompt.
- Semantic index: symbol-aware chunking, embed on `prep_repo`, re-embed changed files only, keyed `(project, ref)`.
- **AC (FR-PLAN-1..3, US-2.3):** Plan renders in the dashboard; planning context stays within the configured repo-map budget (default ≤ 6k tokens); schema-invalid plan triggers a reprompt then a bounded give-up.
- **Testing:** golden tasks assert plan touches the right files; token-budget assertions.
- **DoD:** [../06-agent-architecture.md](../06-agent-architecture.md) §4 realized.

### P3-AGENT-3 — Coder + bounded fix loop
- Deps: P3-AGENT-2.
- Real reason→act→observe loop per Step with the full sandbox toolset; LangGraph checkpoint after every observe; scratchpad + context compaction at the threshold (emits `context.compacted`); non-progress + repeated-error detection ([../06-agent-architecture.md](../06-agent-architecture.md) §6); risky tool calls → HITL via `interrupt()` → Temporal signal.
- Fix loop: failing required `verify` check feeds back, bounded by max cycles.
- **AC (FR-EXEC-3,5,6,8, US-2.4, US-2.5):** implements the plan; tool calls stream to Activity; hitting a soft bound raises an Approval, a hard bound aborts with the right category; non-progress pauses for guidance; an operator comment is injected into the next turn; pause halts after the current tool call.
- **Testing:** golden `smoke`+`core`; chaos (kill worker mid-loop → resume from checkpoint); impossible-task → correct guard behavior.
- **DoD:** [../06-agent-architecture.md](../06-agent-architecture.md) §2 loop implemented with checkpointing.

### P3-AGENT-4 — Reviewer
- Deps: P3-AGENT-3.
- Distinct model where possible; evaluates final diff vs acceptance criteria → structured verdict (`pass`/`concerns`/`block`) + itemized findings (severity + file anchor); checks for debug code, secrets, unrelated changes, missing tests, obvious security issues.
- **AC (FR-REVIEW-1..3, US-2.7):** verdict + findings persisted + `review.finished` event; `block` → fix loop or human review per Project config; findings included in the PR body.
- **Testing:** golden tasks with planted issues (leftover `console.log`, an unrelated file touch, a hardcoded token) — Reviewer must catch them.
- **DoD:** [../06-agent-architecture.md](../06-agent-architecture.md) §1 Reviewer row implemented; review-block HITL gate wired ([../06-agent-architecture.md](../06-agent-architecture.md) §5).

### P3-AGENT-5 — Memory (minimal)
- Deps: P3-AGENT-2, P3-AGENT-4.
- `project_memory` (repo facts, conventions — proposals, curator/human accept), `run_summary` on Run end (with embedding), read paths for Triager (routing) + Planner (avoid past failures) + Coder (conventions as guidance).
- **AC (FR-EXEC-11):** a Run writes a `run_summary`; an accepted repo fact appears in the next Run's repo map; agent memory writes are proposals unless Policy auto-accepts a kind.
- **DoD:** [../06-agent-architecture.md](../06-agent-architecture.md) §4.4 minimal path works; nothing in memory overrides Policy (tested).

## Orchestration — real activities

### P3-ORCH-1 — Wire real agent activities + review-block + non-progress gates
- Deps: P3-AGENT-1..4, P2-ORCH-1.
- Replace stub activities with `RunTriage`/`RunPlan`/`ExecuteStep`/`RunReview`; add `fix_loop` activity with a max-cycles counter; wire review-block + non-progress HITL gates; failure taxonomy mapping ([../06-agent-architecture.md](../06-agent-architecture.md) §10).
- **AC (US-2.8, FR-EXEC-5):** a failed Run shows a specific `failure_category` + last-good step; retry-from-scratch and resume-from-last-good-step both work; provider-all-down pauses (not fails) and auto-resumes.
- **Testing:** integration for each failure category; resume tests; chaos.
- **DoD:** [../05-system-architecture.md](../05-system-architecture.md) §4 fully real for the TS/Node stack.

## Delivery polish

### P3-PROV-1 — PR body + conventional commits + ticket linking
- Deps: P2-ORCH-1, P3-AGENT-4.
- Full PR/MR body template ([../08-git-provider-abstraction.md](../08-git-provider-abstraction.md) §7): summary, AC checklist mapped to changes, file list, verification table, AI-review summary, cost/time, Run backlink, machine marker; conventional-commit message generation + lint; ticket link/comment via Tracker.
- **AC (FR-DELIVER-1,2,6, US-2.7):** PR body has all sections; re-delivery updates the same PR (marker + idempotency key); GitHub Issue gets a linked comment; Workdesk task gets the PR link + "In Review" transition.
- **DoD:** delivery approval gate (Project toggle, default on) enforced.

## Verification pipeline

### P3-CORE-1 — Verification pipeline (build + lint + unit)
- Deps: P2-ORCH-1.
- Project-configured commands run in the sandbox; structured result parsing (test counts, failures); logs + reports as Artifacts; failing required check → fix loop; surface in PR + dashboard. (Integration/E2E deferred to P4.)
- **AC (FR-VERIFY-1,3,4):** `npm run build` + `npm run lint` + `npm test` run; a failing unit test drives one fix cycle then either passes or fails `tests_never_passed`; report artifacts downloadable.
- **DoD:** Verification tab shows streamed logs + results.

## Eval / CI gate

### P3-AGENT-6 — Golden-task suite → CI gate
- Deps: P0-AGENT-2, P3-AGENT-1..4.
- Grow to `smoke` (~8) + `core` (~40) tiers, TS/Node focus for MVP; injection canaries (≥ 10); wire `smoke` + canaries as required PR gates, `core` on merge-to-main + nightly; regression gates ([../17-testing-strategy.md](../17-testing-strategy.md) §4) on `agent_config_version` changes; shadow-run endpoint.
- **AC:** `make eval:smoke` gates PRs; a deliberate prompt-pack regression is blocked by the gate; an injection canary that the agent follows fails CI.
- **DoD:** [../17-testing-strategy.md](../17-testing-strategy.md) §4 gates active.

## Frontend

### P3-FE-1 — Run detail: Plan approve/re-plan + Review tab + Changes polish
- Deps: P2-FE-3, P3-ORCH-1.
- Plan tab: Approve/Reject/Request-re-plan (Maintainer+), version selector; Review tab: verdict + findings with file anchors + override control (with mandatory note); Changes: per-file agent rationale, word-level diff, download patch.
- **AC (US-2.3, US-2.7, FR-DASH-5):** approve a plan from the UI → Run resumes; request re-plan with feedback → Plan v2; override a `block` verdict (Maintainer+) → proceeds, audited.
- **DoD:** [../12-dashboard-ui-spec.md](../12-dashboard-ui-spec.md) §5 tabs complete for MVP.

### P3-FE-2 — Runs queue + Run cost tab
- Deps: P2-CORE-2, P2-INFRA-2.
- Queue list with filters (project/state/model/date/outcome/has-approval), live row updates for non-terminal Runs, bulk cancel/re-run; Cost tab with per-model + per-step breakdown + budget bar.
- **AC (US-2.8, US-3.3 partial, FR-DASH-2):** filters + pagination work at 1k Runs; cost tab matches the ledger.
- **DoD:** [../12-dashboard-ui-spec.md](../12-dashboard-ui-spec.md) §4 realized.

## ChatOps (minimal, for approvals)

### P3-PROV-2 — Slack connector (approvals + status)
- Deps: P2-CORE-4, P2-PROV-1.
- `ChatOpsProvider` for Slack: post approval cards with Approve/Reject buttons, Run status cards, thread updates on state changes, `/praxis status <run>`; verify signing secret; map Slack user → Praxis user; RBAC-check before applying a decision.
- **AC (US-4.3, FR-INT-6, FR-APPROVE-3):** an approval posts to the configured channel; clicking Approve resolves it (dashboard row updates in real time) and records the resolved user; a non-approver's click is refused with an ephemeral message.
- **DoD:** [../09-integration-tool-architecture.md](../09-integration-tool-architecture.md) §3 Slack path works; approval-card shape matches the dashboard.

## Dogfood

### P3-DOC-1 — Dogfood on the Praxis repo
- Deps: everything above.
- Route chore/test/docs/small-bugfix issues on the Praxis monorepo (TS packages) to Praxis with plan+delivery approval forced on, tight budgets.
- **AC:** ≥ 30 Runs; ≥ 45% autonomous PR acceptance (merged with ≤ minor edits) on the green classes; every failed Run → a new golden task filed; wasted-spend + intervention-rate reviewed weekly.
- **DoD:** a short "MVP results" report with the metrics vs [../01-product-vision.md](../01-product-vision.md) targets; go/no-go for P4.
