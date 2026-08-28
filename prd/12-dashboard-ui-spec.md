# 12 — Dashboard & UI Specification

## 1. Product stance

The dashboard is an **operations console**, not a chat window. Its job: show what the fleet of agents is doing right now, let operators approve/steer/stop work, and explain what happened afterward. Everything live is **event-driven** ([11](./11-event-architecture.md)); nothing is faked or synthesized client-side (FR-DASH-9).

- **Framework:** Angular 21 (standalone components + signals) default; Next.js/React acceptable alt (decision at Phase 3 kickoff — [04](./04-technology-research.md) §15). Component lib: Angular Material + CDK (or shadcn/Radix for React).
- **Transport:** REST (via BFF) for reads/actions; **SSE** for live streams; **WS** for control actions + presence.
- **Themes:** light + dark, system-aware. **A11y:** WCAG 2.1 AA on core flows; full keyboard nav.
- **Perf:** first paint < 1.5s with 1k Runs in history; virtualized lists; incremental stream rendering.

## 2. Information architecture

```
┌ Top bar: Tenant switcher · global search (Run/WorkItem/PR) · connection status · notifications · user
│
├ Left nav:
│   ● Overview        (fleet)
│   ● Runs            (queue / history)
│   ● Approvals       (inbox)   ← badge = open count, red if any SLA < 15m
│   ● Work Items      (intake backlog)
│   ● Projects
│   ● Agents & Policies
│   ● Analytics
│   ● Integrations    (connectors, MCP, ChatOps)
│   ● System Health
│   ● Audit Log
│   ● Settings        (members, roles, budgets, retention, providers)
│
└ Main content (route-driven) + right-hand contextual drawer (Run peek, approval detail)
```

## 3. Screen: Overview (fleet) — FR-DASH-1, 3.1

**Purpose:** one glance = state of everything.

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│  OVERVIEW                                                   ⟳ live · connected          │
├───────────────┬───────────────┬───────────────┬───────────────┬───────────────────────┤
│ RUNNING  12   │ QUEUED   7    │ WAITING   3   │ SUCCEEDED 48  │ FAILED 5   (last 24h)  │
│ ▲ 3 vs 1h ago │               │ ⏱ 1 SLA<15m  │  90% rate     │  taxonomy ▸            │
├───────────────┴───────────────┴───────────────┴───────────────┴───────────────────────┤
│  ACTIVE AGENTS (12)                          │  OPEN APPROVALS (3)                     │
│  ┌─────────────────────────────────────────┐ │  ┌───────────────────────────────────┐ │
│  │ ● run 8f2 · Coder · claude-sonnet        │ │  │ ⏱ 12m  Plan · proj "billing"      │ │
│  │   step 3/6 "add retry policy"            │ │  │        run 8f2 · [review]         │ │
│  │   ▓▓▓▓▓░░░ tool: test.run (4.2s)         │ │  │ ⏱ 41m  Open PR · proj "web"       │ │
│  │   $0.84 · 142k tok · 6m12s               │ │  │ ⏱ 3m ‼ Egress · proj "infra"      │ │
│  │ ● run a13 · Planner · gpt-…              │ │  └───────────────────────────────────┘ │
│  │   analyzing repo · 18 files read         │ │                                        │
│  │  … (virtualized)                         │ │  SYSTEM HEALTH                          │
│  └─────────────────────────────────────────┘ │  Sandbox pool  38/64 leased · 12 warm  │
│                                              │  Event bus lag  22 ms                   │
│  RECENT EVENTS (stream)                      │  Model errors   0.3% (5m)               │
│  10:04:12 run 8f2 → verifying               │  Connectors     ● jira ● github ○ slack │
│  10:04:03 run c90 delivered PR #241         │  Budget (tenant) 62% of $2,000 · proj.  │
│  10:03:51 approval requested run 8f2        │                                        │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Live behavior:** subscribes to `tenant.<id>.fleet` SSE. Counters update on `fleet.counters` (throttled ≤1s). Active-agent cards update per Run on `run_step.*`, `tool_call.*`, `run.totals_updated`. Recent-events feed is a capped, auto-scrolling list (pause-on-hover). Health tiles from `system.health`. Clicking any card → Run detail; clicking an approval → approval drawer.

## 4. Screen: Runs (queue & history) — FR-DASH-2, 3.x

- **Filters:** project, state (multi), agent config, model, date range, outcome, failure category, "has open approval", created-by. Saved filter views per user.
- **Table columns:** Run (short id + WorkItem title), Project, State (chip + mini progress), Current step, Model(s), Duration, Cost, Tokens, Files changed, PR (link + check status), Age. Sortable; virtualized; server-side paginated.
- **Row live-updates** for non-terminal Runs (subscribe to visible rows' Run topics with a shared multiplexed SSE, or poll the BFF list every 3s as a fallback for very long lists — the *cells* still reflect real persisted state).
- **Bulk actions** (RBAC-gated): cancel, re-run, change priority.
- **Row peek**: hovering/clicking opens the right drawer with the Run summary + jump-in button.

## 5. Screen: Run Detail — FR-DASH-5, 3.11, 3.12 (the centerpiece)

Route `/runs/:id`. Tabs, with a persistent header.

```
┌ run 8f2c…  ·  "Add WhatsApp notification when attendance marked"  ·  proj billing ──────────┐
│ STATE ▓▓▓▓▓▓░░ verifying   │ 6m48s │ $1.24 │ 168k tok │ 7 files │ branch praxis/EDAP-142   │
│ [Pause] [Comment] [Cancel]           agent: default v7 · policy: Balanced v3               │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  Plan │ Steps │ Activity │ Changes │ Verification │ Review │ PR │ Logs │ Cost │ Timeline   │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ (Activity tab — default while running)                                                    │
│  ▸ Step 3/6  Coder · "add retry policy to NotificationService"        running · iter 4/12  │
│     10:03:40  💬 "The send() call has no retry. I'll wrap it with a backoff policy…"      │
│     10:03:44  🔧 code.search  "class NotificationService"        → 2 hits    (120ms)      │
│     10:03:46  🔧 fs.read  src/notifications/service.ts:1-80      → 80 lines  (40ms)       │
│     10:03:52  🔧 fs.patch  src/notifications/service.ts         → +23 −4     (30ms)  ▸diff │
│     10:03:58  🔧 test.run  npm test -- notifications            → 12 pass / 1 fail (4.2s) │
│     10:04:05  💬 "The retry test expects 3 attempts; my default is 2. Adjusting…"        │
│     ░ streaming…                                                                          │
│  ▸ Step 2/6  ✅ "add notification template"                          done · 2 iters       │
│  ▸ Step 1/6  ✅ "inspect existing WhatsApp integration"             done                  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Tab contents

| Tab | Content | Source |
|-----|---------|--------|
| **Plan** | Rendered Plan (summary, ordered steps with rationale/files/risk, test strategy, risk notes). Version selector if re-planned. Approve/Reject/Request-re-plan controls if `awaiting_plan_approval` (RBAC: Maintainer+). | `plan`, `plan_step`, `approval` |
| **Steps** | Compact list of all Steps with state, iterations, duration, cost, tool-call count; click → jumps to that step in Activity. | `run_step` |
| **Activity** | The live stream above: interleaved model messages, tool calls (name, args preview, result, duration, artifact link), context-compaction and progress-warning markers. Filter by step / tool / role. "Jump to live". | SSE `message.*`, `tool_call.*`, backfill from `run_event` |
| **Changes** | File tree of touched files + unified diff viewer (syntax-highlighted, expand/collapse hunks). Updates live on `git.commit.created` / `fs.patch`. Per-file "why" from the agent. Download patch. | `artifact(kind=diff)`, live diff assembly |
| **Verification** | Each check (build/lint/unit/integration/e2e) as a row: status, duration, summary (e.g. "142 passed / 1 failed"), streamed log (tail), full log artifact, coverage delta. | `verify.*` events, `artifact` |
| **Review** | AI reviewer verdict (pass/concerns/block) + itemized findings with severity + file anchors. Human "override" control (Maintainer+) with mandatory note. | `review.finished`, `approval(type=review_block)` |
| **PR** | Branch name, commit list, PR link + state, external CI checks, PR body preview. "Open in GitHub/GitLab". | `git.*`, `vcs.pr.*` |
| **Logs** | Raw event log for the Run (filterable by type), and links to all artifacts. Export. | `run_event` |
| **Cost** | Per-model breakdown (calls, input/output/cached tokens, $), per-step cost, fallbacks used, cache hits, budget consumption bar. | `model_call` ledger |
| **Timeline** | Horizontal time axis: Step bars, approval waits (as gaps with a lock icon), verification blocks, delivery. Hover = detail. Shows where time actually went. | `run_event` |

### Header actions (RBAC-gated, WS)
- **Pause** → `run.pause` (halts after current tool call; header shows "paused", Resume appears).
- **Comment** → modal → `run.comment` (injected as a user message next agent turn; appears in Activity as `operator.message`).
- **Cancel** → confirm → `run.cancel` (sandbox torn down; pushed branch kept with a note).
- **Retry / Resume-from-step** (terminal Runs) → creates a new Run (retry) or resumes from `lastGoodStepId`.

### Live/connection UX (NFR-UX-4)
- A persistent "● live · connected" / "○ reconnecting…" indicator. On reconnect, SSE backfills missed events (seq-based) and a subtle "caught up" toast shows. If the Run reached a terminal state while disconnected, the view swaps to the final state with all tabs populated from persisted data.

## 6. Screen: Approvals inbox — FR-DASH-3, 2.6, 3.2

```
┌ APPROVALS (3 open)                              filter: [all types ▾] [all projects ▾]   │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ⏱ 3m ‼  Egress outside allowlist   proj infra · run 55a · Coder                          │
│         wants: shell.exec  "curl https://api.thirdparty.io/schema"                        │
│         reason: host not in project egress allowlist                                     │
│         evidence ▸ (current diff, step context)          [Approve] [Reject] [＋note]      │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ⏱ 12m   Plan approval             proj billing · run 8f2                                  │
│         6 steps · ~7 files · risk: medium (touches payment retry path)                    │
│         open plan ▸                                       [Approve] [Reject] [Re-plan]    │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ⏱ 41m   Open PR                   proj web · run c90                                      │
│         base: main ← praxis/WEB-88 · 4 files · verification ✅  · review: pass            │
│         preview PR body ▸                                 [Approve] [Reject]              │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- Sorted by SLA urgency; SLA < 15m flagged red; expired items move to a resolved section with "expired — Run failed safe".
- Each row expands to full evidence (diff, action payload, step context, cost so far).
- Decisions require RBAC (Maintainer+); optional/required note per type (required for overrides & rejections).
- Bulk-approve for same low-risk type when Policy's `standing approvals` allows.
- Mirrors to Slack; a Slack decision closes the row here in real time (`approval.decided`).

## 7. Screen: Work Items (intake backlog) — FR-INTAKE, 2.1, 2.2

- List of WorkItems by state (`received`/`triaging`/`ready`/`needs_info`/`in_progress`/`delivered`/`rejected`), source, project, size estimate, verdict.
- Detail: normalized fields, parsed acceptance criteria, attachments, link to source ticket, triage reasoning, `needs_info` questions (with "post to ticket" action), "Start Run" (if manual-start), history of Runs for this item.
- Manual create form (FR-INTAKE-4): paste text / fill fields → choose project → optional immediate start.

## 8. Screen: Analytics — FR-DASH-7, 3.3, 3.4

Time-window selector (24h / 7d / 30d / custom), per-Project filter.

| Panel | Viz |
|-------|-----|
| Throughput | Runs started vs delivered vs failed per day (stacked bars) |
| Success rate | line + current % ; segmented by ticket type/size |
| Run duration | distribution (histogram) + p50/p90; median trend line |
| Human intervention rate | interventions per successful Run, trend |
| Failure taxonomy | breakdown by `failure_category` (bar), click → filtered Runs |
| Cost | $/day stacked by model; $/successful Run; **wasted spend** (cost on failed/cancelled Runs) |
| Cost by project / model | tables with sparklines |
| Tokens | input vs output vs cached, trend |
| Value estimate | "tasks delivered" × configurable human-hours-saved baseline → hours & $ saved |
| Provider reliability | error rate & fallback rate per provider |

Every chart supports drill-through to the underlying Run list. Data from `model_call` ledger + `run` totals + materialized views ([10](./10-database-architecture.md)); refreshed ≤ 1 min.

## 9. Screen: Projects

- List + create/edit ([03](./03-user-stories.md) US-1.4): repo (via connector), tracker sources + intake filter, base branch, verification pipeline (build/lint/test/integration/e2e commands + compose file), branch template, default agent config, policy preset + overrides, per-Run budgets, notification channels.
- "Readiness check" panel: repo clonable ✓, test command detected ✓, model reachable ✓, connector healthy ✓.
- Per-project mini-dashboard: recent Runs, success rate, cost, open approvals.

## 10. Screen: Agents & Policies — FR-INT-7/8, 3.5

- **Agent configs:** per role — model binding (+ fallbacks), toolset (enable/disable individual tools), prompt pack (view/edit with diff), context strategy knobs (repo-map budget, compaction threshold), guardrail overrides (within maxima).
- **Versioning:** every save = new `agent_config_version`; diff view; rollback; "promoted" flag.
- **Shadow run:** pick a golden task set (or "mirror last N real Runs") → run the candidate version without delivering → compare pass rate / cost / findings vs current. Promote gate blocks regressions ([17](./17-testing-strategy.md)).
- **Policies:** rule editor (allowed/forbidden paths, shell allowlist, egress allowlist, risk-tier overrides, max files, protected branches, memory auto-accept). Presets: Conservative / Balanced / Autonomous. Platform maxima shown as hard ceilings. All changes audited.

## 11. Screen: Integrations

- **Connectors** catalog: installed + available; per connector — status, health detail, config, credential reference (write-only), which projects use it, enable/disable, reconnect.
- **MCP servers:** register (endpoint, transport, OAuth/token), enumerated tools/resources, per-project assignment + risk tier.
- **ChatOps:** Slack workspace link, channel routing per event type, `/praxis` command status, user mapping table (Slack ↔ Praxis user).
- **Outbound webhooks** (P1): endpoint registry, event filter, delivery log, secret.

## 12. Screen: System Health — FR-DASH-8

- Sandbox pool: total/leased/warm/failed, cold-start p95, per-runner-class breakdown.
- Queues: depth per queue, oldest job age, worker count, autoscale state.
- Event bus: publish/consume rate, lag, dead-letter count.
- Model gateway: RPS, error rate, p95 latency per provider, circuit-breaker states, fallback rate.
- Temporal: open workflows, task-queue backlog, activity failure rate.
- Connectors: health matrix, last ingress time, webhook failure rate.
- DB: connections, slow queries, replication lag, partition sizes.
Links out to Grafana for deep dives; this screen is the "is the platform OK?" summary.

## 13. Screen: Audit Log — FR-PLAT-4, 5.2

- Filter by actor, action type, target (Run/Project/Connector/Secret), date.
- Columns: time, actor (user/service/agent), action, target, before→after (expandable).
- Export JSON/CSV. Chain-verification status badge ("integrity: verified 10:00").

## 14. Screen: Settings

- **Members & roles:** invite, assign role, deactivate; SSO config (P1).
- **Providers:** add OpenAI/Anthropic/Gemini/self-hosted; test call; role defaults; fallback chains; allowed data regions; monthly budget + on-breach behavior.
- **Budgets:** tenant + per-project caps, soft %, alerts.
- **Retention:** per-data-type windows; hard-delete request flow.
- **Branding/theme**, **API tokens** (personal + service accounts), **notification preferences**.

## 15. Shared components

| Component | Behavior |
|-----------|----------|
| **Diff viewer** | virtualized, syntax-highlighted, hunk collapse, word-level intra-line diff, "expand context", per-file "agent rationale" callout, copy/download patch |
| **Event stream list** | append-only, auto-scroll with pause-on-hover/scroll-up, "jump to live", type filter, timestamp + relative time, icons per event class |
| **Log tail** | streamed text with ANSI color, search, wrap toggle, download full |
| **Stat tile** | value + delta vs prior window + sparkline; consistent in light/dark ([dataviz] palette) |
| **State chip** | color + label per Run/Step/Approval state; consistent everywhere |
| **Progress bar** | maps to `completedSteps/totalSteps` (from persisted plan), never a fake timer |
| **Cost badge** | $ + tokens + model list; hover → per-model breakdown |
| **Approval card** | evidence, action payload, SLA countdown, decision buttons + note; identical shape in dashboard & Slack |
| **Connection indicator** | live/reconnecting/offline; global + per-stream |
| **RBAC gate** | hides/disables actions by role; shows "requires Maintainer" tooltip |

## 16. Real-time implementation rules (enforced in review)

1. Any number that changes while a Run runs is bound to an SSE event or a BFF value that reads persisted state. No `setInterval` incrementing a counter.
2. Progress = `steps done / steps planned` or an explicit backend `progress.*` event. No time-based fake progress.
3. Every list of live items reconciles against a periodic BFF snapshot (self-heal if an event was missed).
4. On reconnect, always backfill by `seq`/`lastEventId` before showing "live".
5. Token/log streams render incrementally; never buffer-until-done.
6. If the stream is unavailable, the UI still renders the last known persisted state and says "not live".

## 17. Non-goals for the UI (v1–GA)
- No in-browser code editing for humans (read-only diff only).
- No drag-and-drop workflow builder (agent flow is orchestrator-defined).
- No embedded terminal into the sandbox (logs + tool-call view only) — a read-only "sandbox shell viewer" is a Future item behind RBAC.
- No white-label theming beyond logo + accent color in v1.
