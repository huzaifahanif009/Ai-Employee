# Phase 0 — Research & De-risking Spikes

**Goal:** produce a runnable spike + a written keep/change/kill finding for every high-risk unknown before committing to the architecture. No production code; spikes live in `spikes/` and are disposable.

**Exit criteria:** every task below has (a) a runnable artifact, (b) a 1-page finding, (c) a decision recorded in [../04-technology-research.md](../04-technology-research.md) or an ADR. Milestone **M0** demo passes.

---

## P0-SBX-1 — Firecracker microVM pool spike
- **Summary:** Boot a Firecracker VM from a prebuilt rootfs, clone a repo into it, run `npm test`, stream stdout back over a socket, snapshot + restore, destroy. Measure cold start (cold + warm-pool), snapshot/restore time, teardown.
- **Deps:** a Linux host with KVM (bare metal or nested-virt VM).
- **AC:**
  - Warm-pool cold start p95 < 8 s; snapshot+restore round-trip works and resumes a paused process.
  - Egress from inside the VM is default-deny; an allowlist proxy permits only `registry.npmjs.org` + a test Git host; `169.254.169.254` blocked.
  - No host filesystem visible in the guest; guest runs non-root.
- **Testing:** script runs 20 boot/test/destroy cycles; assert no orphan processes, no leaked tap devices, stable memory.
- **DoD:** finding covers "own pool vs E2B vs gVisor-only", rootfs build approach, and the `SandboxProvider` method list this implies.

## P0-SBX-2 — gVisor fallback spike
- **Summary:** Same workload as P0-SBX-1 under `runsc` on a host without nested virt (e.g. a standard CI runner).
- **Deps:** none special.
- **AC:** workload runs; syscall-filtered; egress controllable; document isolation gaps vs Firecracker.
- **DoD:** finding: which environments get gVisor by default; perf delta.

## P0-ORCH-1 — Temporal + LangGraph dual-durability spike
- **Summary:** A Temporal workflow with 3 activities; activity 2 calls a Python LangGraph graph (gRPC) that does a 4-step reason/act loop with a checkpointer (Postgres). Kill the Python worker mid-loop; kill the Temporal worker mid-activity. Verify resume in both cases. Add a `humanApproval` signal that pauses activity 2 at a LangGraph `interrupt()` and resumes on signal.
- **Deps:** P0-PROV-1 (model calls) can be stubbed initially.
- **AC:**
  - Python worker kill → LangGraph resumes from last checkpoint, no duplicated side effects.
  - Temporal worker kill → workflow resumes, activity re-runs idempotently.
  - Approval: `interrupt()` → workflow raises + `await`s signal → signal → graph resumes past the interrupt; code *before* the interrupt is proven safe-to-rerun.
- **Testing:** 50 chaos iterations with random kill points; assert exactly-once on a marker side effect (row insert with unique key).
- **DoD:** finding: ownership split doc (what Temporal owns vs LangGraph owns), gRPC contract sketch for `AgentRuntime`, and the "no side effects before an interrupt" rule written into [../06-agent-architecture.md](../06-agent-architecture.md).

## P0-PROV-1 — Model Router + LiteLLM spike
- **Summary:** Stand up self-hosted LiteLLM with OpenAI + Anthropic + one self-hosted OpenAI-compatible endpoint (Ollama). A thin `ModelRouter` in front does: attribution tags, a fake budget reserve/settle, redaction of a planted secret, an exact cache, and a fallback chain (Anthropic → OpenAI on injected 429). Normalize tool-calling + streaming across all three.
- **Deps:** test API keys.
- **AC:**
  - One code path calls all three providers; tool-call round-trip + streamed assembly identical shape.
  - Injected 429 on primary → automatic fallback; both attempts recorded.
  - Planted secret never appears in the outbound payload or the recorded trace.
  - Cost computed from a catalog price table and written to a ledger row.
- **Testing:** contract-style tests with cassettes; a live smoke.
- **DoD:** finding confirms the two-layer design (Router + LiteLLM) or proposes an alternative; seeds the `ProviderAdapter` + catalog schema in [../07-ai-provider-abstraction.md](../07-ai-provider-abstraction.md).

## P0-AGENT-1 — Coding-loop feasibility spike
- **Summary:** A single LangGraph "Coder" graph with tools (`fs.read/list`, `fs.patch`, `code.search` via ripgrep, `test.run`, `git.*`) executing against 5 hand-picked small tasks (2 bugfix, 2 tiny feature, 1 test backfill) on 2 fixture repos (Node + Python), inside the P0-SBX sandbox. Bounded loop (12 iters). Repo map via tree-sitter.
- **Deps:** P0-SBX-1/2, P0-PROV-1.
- **AC:**
  - ≥ 3/5 tasks reach green tests + a clean diff touching only expected files, unattended.
  - Repo map + `code.search` keep the planning context < 8k tokens.
  - Loop guards (max iters, non-progress) trigger correctly on a deliberately impossible task.
- **Testing:** run each task 3× (non-determinism); record pass rate, cost, tokens, iterations.
- **DoD:** finding: which tool set is minimally sufficient, context-budget numbers, the first ~10 golden tasks committed to the eval harness skeleton.

## P0-AGENT-2 — Golden-task harness skeleton
- **Summary:** A runner that takes `{work_item.md, repo bundle, rubric}` → executes the P0-AGENT-1 graph → scores the rubric → writes a result row (pass, cost, tokens, wall, iters). Store as a Langfuse dataset.
- **Deps:** P0-AGENT-1.
- **AC:** `make eval:smoke` runs ≥ 8 tasks, prints a pass-rate + cost table, exits non-zero if pass rate < a floor.
- **DoD:** harness reused unchanged in P3 as a CI gate.

## P0-FE-1 — Real-time transport spike (SSE + WS)
- **Summary:** A tiny NestJS service publishes synthetic Run events to Redis Streams; an SSE endpoint fans out with `Last-Event-ID` backfill from a Postgres `run_event` table; a WS channel handles `pause`/`resume` round-trips. A minimal Angular page renders a live event list + a diff component fed by streamed patches. Force-drop the SSE connection; assert backfill with no gaps/dupes (seq-based).
- **Deps:** none.
- **AC:**
  - Reconnect after a 30 s outage → exact backfill, no duplicates, "caught up" shown.
  - 1k synthetic events/s to 200 simulated SSE clients on one instance → render lag < 750 ms p95.
  - WS `pause` → `ack` round-trip < 100 ms local.
- **DoD:** finding: SSE+WS split confirmed or adjusted; event envelope + `seq` semantics fixed for [../11-event-architecture.md](../11-event-architecture.md).

## P0-PROV-2 — VCS + Tracker adapter spike
- **Summary:** Implement a minimal `VcsProvider` for GitHub (Octokit + App auth): create branch, read file at ref, mint an installation token scoped to one repo with a short TTL, open a PR, update the *same* PR (assert no duplicate), add a comment, read checks. Implement a minimal `TrackerProvider` for GitHub Issues + a read-only `EDAP Workdesk` client (REST list + `/workdesk` socket subscribe) mapping to a `WorkItemDraft`.
- **Deps:** a test GitHub org + App; access to a running EDAP Workdesk/`edap-ticketing-service` instance or its OpenAPI.
- **AC:**
  - Ephemeral token is repo-scoped and expires; PR update is idempotent; protected-branch detection works.
  - Workdesk task → normalized `WorkItemDraft` with acceptance criteria parsed from description + checklist; a `task.updated` socket event is received.
- **DoD:** finding: contract method list confirmed for [../08-git-provider-abstraction.md](../08-git-provider-abstraction.md) / [../09-integration-tool-architecture.md](../09-integration-tool-architecture.md); Workdesk integration is public-surface-only.

## P0-SEC-1 — Threat model + redaction/injection spike
- **Summary:** Write the initial STRIDE threat model. Build a redaction function (secret patterns + provided regexes + known-value list + high-entropy) with a property test. Build 5 prompt-injection fixtures and run them through the P0-AGENT-1 graph with policy enforcement stubbed; confirm the agent can't exceed an allowlisted toolset even when told to.
- **Deps:** P0-AGENT-1.
- **AC:** redaction never leaks on 1k generated cases; injection fixtures do not cause a `forbidden`/unapproved action; findings feed [../14-security.md](../14-security.md).
- **DoD:** threat model reviewed; redaction lib promoted to a real package in P1.

## P0-INFRA-1 — Polyglot boundary + CI spike
- **Summary:** A repo layout with a TS service and a Python service sharing a proto (`buf`), codegen for both, a shared JSON-Schema event package with generated TS + Python types, and a GitHub Actions pipeline that lints/tests both and spins a Compose-lite stack.
- **Deps:** none.
- **AC:** `buf generate` + schema codegen wired; one `docker compose` brings up both services healthy; CI green in < 10 min.
- **DoD:** finding: monorepo tooling choice (pnpm workspaces + uv/poetry; Nx/Turbo optional); this layout becomes the P1 skeleton.

## P0-DOC-1 — Findings consolidation
- **Summary:** Roll all findings into updates to [../04-technology-research.md](../04-technology-research.md) and a short ADR set (`docs/adr/000x-*.md`). Confirm or revise every "Decision" and "Revisit trigger".
- **AC:** each P0 task's decision is reflected; any changed decision has a rationale.
- **DoD:** Phase 1 can start against frozen-v0 intentions.
