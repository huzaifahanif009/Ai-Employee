# 06 — Agent Architecture

## 1. Model of an agent

An **Agent** is a *definition*: `{ role, model_binding, toolset, prompt/policy pack, guardrails, context strategy }`. An **Agent Session** is a running instance of that definition bound to a Run, executed as a **LangGraph graph** on a Python Agent Worker. Multiple Agent Sessions can participate in one Run (Planner → Coder ↔ Reviewer).

### Roles (v1)

| Role | Purpose | Default model class | Tools |
|------|---------|--------------------|-------|
| **Triager** | Classify type/size, readiness verdict, routing | small/fast | `tracker.read`, `code.search` (shallow), `fs.read` (limited) |
| **Planner** | Inspect repo, produce the Step plan + risk | strong reasoning, large context | `repo.map`, `code.search`, `fs.read`, `web.search` (allowlist), `memory.read` |
| **Coder** | Implement each Step; run the fix loop | strong coding model | full FS/shell/test/git toolset (per Policy) |
| **Reviewer** | Evaluate final diff vs acceptance criteria | strong reasoning (distinct from Coder's model where possible) | `git.diff`, `fs.read`, `code.search`, `test.run` (read-only rerun) |
| **Researcher** (P1) | Deep external/library research feeding Planner/Coder | strong, web-enabled | `web.search`, `web.fetch`, `mcp.*` docs tools, `memory.write` |

Roles are configurable; a Tenant can add custom roles with their own prompt pack + toolset within platform maximums.

## 2. The agent loop (per role, LangGraph)

```
        ┌─────────────┐
        │  assemble   │  context strategy builds the window:
        │  context    │  system+policy · task · repo map · retrieved snippets ·
        └──────┬──────┘  memory · scratchpad summary · tool schemas · prior turn
               ▼
        ┌─────────────┐
        │  model call │  via ModelRouter (stream tokens as events)
        └──────┬──────┘
               ▼
        ┌─────────────┐   no tool calls ──► ┌──────────────┐
        │  parse      │────────────────────►│  finalize    │──► emit result artifact
        │  response   │                     └──────────────┘
        └──────┬──────┘
               │ tool call(s)
               ▼
        ┌─────────────┐   risky? ──► raise Approval (LangGraph interrupt / Temporal signal)
        │  guard +    │
        │  dispatch   │──► Tool Broker ──► sandbox ──► result
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │  observe +  │  append tool result; update scratchpad; check budget & progress
        │  checkpoint │  (LangGraph checkpointer → Postgres)  ──► loop
        └─────────────┘
```

- **Checkpoint after every observe.** A worker crash resumes the graph from the last checkpoint; Temporal resumes the enclosing activity.
- **Streaming.** Token deltas, tool-call start/args/result, and step transitions are emitted as AG-UI-style events in real time.

## 3. Planner → Coder → Reviewer orchestration

The **Run Orchestrator (Temporal)** — not an LLM — sequences roles. This keeps control-flow deterministic and auditable; LLMs decide *within* a role, not *which role runs next*.

```
RunWorkflow
 ├─ activity: triage            (Triager session)
 ├─ activity: prep_repo         (sandbox + repo map)
 ├─ activity: plan              (Planner session) ──► [Approval gate?]
 ├─ loop over plan.steps:
 │    ├─ activity: execute_step (Coder session, bounded loop)   ──► [Approval gate on risky tool]
 │    └─ activity: verify_step  (optional per-step checks)
 ├─ activity: verify_full       (build/unit/integration/e2e)
 │    └─ on fail ─► activity: fix_loop (Coder session, bounded)  ─► re-verify (max N cycles)
 ├─ activity: review            (Reviewer session)
 │    └─ verdict=block ─► fix_loop OR human review (per config)
 ├─ activity: deliver           ──► [Approval gate?]  ──► commit/push/PR
 └─ complete
```

Multi-agent *within* a step (P1): Coder and Reviewer can run a tight sub-loop ("write → self-review → revise") before the step is marked done, bounded by its own iteration cap. Handoff is a structured message (`{ decision, findings[], patch_ref }`), not free chat.

## 4. Context engineering

Goal: give each role the *least* context that lets it act well, and keep the window stable across long runs.

### 4.1 Repo map (cheap orientation)
Built once per Run at repo-prep, cached, refreshed on large diffs:
- File tree (respecting `.gitignore` + a size cap), with per-file language and LOC.
- Symbol index via **tree-sitter**: top-level classes/functions/exports with signatures (not bodies).
- Dependency manifest summary (package.json/pyproject/pom/go.mod), test command(s) detected.
- `AGENTS.md` / `CONTRIBUTING.md` / `.praxis/agent.md` verbatim if present (curated repo guidance materially improves focus and cuts tokens).
Rendered as a compact tree + symbol list; token-budgeted (default ≤ 6k tokens, configurable).

### 4.2 Retrieval (targeted depth)
- **Lexical first:** ripgrep via `code.search` — fast, precise, the agent's primary navigation tool.
- **Semantic:** on repo-prep, chunk code + docs (symbol-aware chunking), embed, store in `pgvector` keyed by `(project_id, ref)`. `code.search --semantic` returns ranked snippets with file+line anchors. Re-embed only changed files.
- The agent pulls **full file bodies on demand** via `fs.read` (with line ranges); it is prompted to prefer ranges over whole files.

### 4.3 Working memory (scratchpad)
- A structured, agent-maintained scratchpad: `goal`, `findings`, `decisions`, `open_questions`, `files_touched`, `next`.
- When the window approaches a threshold (e.g. 70% of model context), the runtime **compacts**: summarize older turns into the scratchpad, drop raw tool outputs already reflected in the diff, keep the last K turns verbatim.
- Compaction is itself a model call (cheap model), logged as an event so the timeline shows "context compacted".

### 4.4 Long-term memory (across Runs) — [10](./10-database-architecture.md) has the schema
| Memory kind | Written by | Read by | Store |
|-------------|-----------|---------|-------|
| **Repo facts** | Researcher/Planner (proposed) → curator/human accept | Planner, Coder | `project_memory` (typed rows) + rendered into repo map |
| **Run outcomes** | Orchestrator on Run end | Triager (routing), Planner (avoid past failures) | `run_summaries` |
| **Code/doc embeddings** | repo-prep | `code.search --semantic` | `pgvector` |
| **Learned conventions** | Reviewer (recurring findings) → curator | Coder (as lint-style guidance) | `project_memory` |
Memory writes by agents are **proposals** by default; a Policy can auto-accept low-risk kinds. Nothing in memory overrides Policy.

## 5. Human-in-the-loop (HITL)

HITL points are **designed boundaries**, not arbitrary pauses (per 2026 HITL guidance: place interrupts at business-decision boundaries; keep enough evidence in the payload; back it with durable checkpointing + audit).

| Gate | Trigger | Payload to reviewer | Resume mechanism |
|------|---------|--------------------|------------------|
| **Plan approval** | Project policy | Plan (steps, files, tests, risk), repo summary, cost estimate | Temporal signal `approvalGranted/Rejected` (+ optional edited plan) |
| **Risky tool** | Tool risk tier = `approve` | Exact tool + args, affected paths, current diff, why it's risky | signal; on approve the exact call proceeds |
| **Budget soft limit** | tokens/USD/time/iterations ≥ soft threshold | Spend so far, projection, what's left to do | signal with `+budget` grant or `stop` |
| **Review = block** (config) | Reviewer verdict | Findings list, diff | signal `sendToFixLoop` or `deliverAnyway` (Maintainer only) or `reject` |
| **Delivery** | Project policy | Final diff, PR body preview, target repo/branch | signal `approvalGranted` |
| **Non-progress** | progress detector | Loop evidence (repeated calls, no test delta) | Operator: `resume`, `injectGuidance`, `cancel` |

Implementation: LangGraph `interrupt()` serializes graph state; the Temporal activity that hosts the session returns a "needs approval" result; the workflow creates the Approval row, emits `APPROVAL_REQUESTED`, sets an SLA timer, and `await`s the signal. On approval the activity is retried with the decision injected; LangGraph resumes from the checkpoint. **Code before an `interrupt()` may re-run** — side-effecting steps are placed *after* gates, never before.

## 6. Loop / runaway control

Every bound is enforced by the Orchestrator (deterministic), not trusted to the LLM.

| Guard | Default | Soft action | Hard action |
|-------|---------|-------------|-------------|
| Max iterations / step | 12 | Approval at 10 | abort step → `fix_loop` or fail |
| Max fix-loop cycles | 4 | — | fail `tests_never_passed` |
| Max wall-clock / Run | 45 min | Approval at 35 | `timed_out` |
| Max tokens / Run | 2.0M | Approval at 1.6M | abort |
| Max USD / Run | $5 | Approval at $4 | abort |
| Max tool calls / Run | 400 | Approval at 320 | abort |
| Max files changed | 40 | Approval at 30 | abort |
| Non-progress | 3 no-delta iterations OR identical tool call ×3 OR diff oscillation detected | pause for review | — |
| Repeated tool error | same error ×3 | inject error-analysis prompt; if persists → pause | — |

**Non-progress detection:** hash of `(tool_name, normalized_args)` for repetition; test pass/fail vector diff per iteration; diff similarity (token-level) across iterations; "no new files read + no new lines written" counter.

All defaults overridable per Project within platform maximums; changes audited.

## 7. Prompt & policy packs

- A **prompt pack** per role: system prompt, tool-use guidance, output format contracts (JSON schema for Plan, Review verdict), few-shot exemplars, and repo-guidance injection points.
- Packs are **versioned artifacts** (`agent_config_versions`), diffable, roll-back-able, and testable via shadow runs against golden tasks ([17](./17-testing-strategy.md)).
- A **policy pack** (machine-enforced, not prompt-only): allowed paths (globs), forbidden paths (e.g. `infra/**`, `.github/workflows/**` unless explicitly allowed), allowed shell commands (allowlist + arg patterns), max files, egress allowlist, protected branches, memory auto-accept rules. Policy is evaluated by the Tool Broker/Orchestrator **before** any tool executes.

## 8. Tool execution model

- Agent emits a tool call → LangGraph node → **Tool Broker** validates against JSON schema + Policy + risk tier → dispatches:
  - **In-sandbox tools** (`fs.*`, `shell.exec`, `test.run`, `git.*`, `code.search`) run inside the Run's microVM via the runner agent; output streamed and truncated (full output stored as an Artifact, linked).
  - **Control-plane tools** (`vcs.open_pr`, `tracker.comment`, `slack.post`, `memory.*`) run in the control plane with the connector's scoped credentials — never in the sandbox.
  - **MCP tools** proxied by the Tool Broker's MCP client.
- Every call → `tool_call` row + `TOOL_CALL_START`/`TOOL_CALL_RESULT` events with duration, bytes, status.
- Idempotency: tools declare `idempotent: true|false`; non-idempotent control-plane tools (open PR) use an idempotency key derived from `(run_id, step_id, tool, args_hash)`.

## 9. Determinism, evaluation, improvement

- **Trace everything** to Langfuse: per role, per turn, prompt+response (redacted), tokens, cost, tool calls, latency.
- **Golden task suite** ([17](./17-testing-strategy.md)): frozen WorkItem + repo fixture + rubric. CI runs a fast subset; nightly runs the full set; results tracked as a quality time series (pass rate, cost, human-intervention proxy).
- **Shadow mode:** a new prompt/model/policy version runs against goldens (and optionally mirrors real Runs without delivering) before promotion.
- **Regression gates:** a config version cannot be promoted if golden pass rate drops > X% or median cost rises > Y%.

## 10. Failure taxonomy (agent-side)

| Category | Meaning | Typical cause | Auto-remedy |
|----------|---------|--------------|-------------|
| `needs_info` | Under-specified ticket | Missing AC / ambiguous scope | pause, ask on ticket |
| `plan_rejected` | Human rejected plan | Wrong approach | end Run; feedback captured |
| `tests_never_passed` | Fix loop exhausted | Hard bug / flaky suite / env gap | fail; attach last diff + logs |
| `non_progress` | Loop with no delta | Model stuck / bad context | pause for guidance |
| `budget_exceeded` | Hard bound hit | Task bigger than budget | fail; suggest split |
| `policy_block` | Needed a forbidden action | Task requires infra/CI change | fail; route to human |
| `provider_unavailable` | All model routes down | Outage | pause (not fail); auto-resume |
| `sandbox_error` | VM/tooling failure | Toolchain missing / OOM | retry on fresh VM once, else fail |
| `vcs_error` | Push/PR failed | Perms / protected branch / conflict | surface exact provider error; human |
