# ADR-0002 — Temporal for Run orchestration, LangGraph for the in-agent loop

**Status:** Accepted · **Date:** 2026-08-28 · **Refs:** prd/04 §1,§3 · prd/06

## Context
A Run spans minutes to days (human approval waits), must survive worker crashes and deploys, needs per-step retries/timeouts and external signals (approve/cancel/comment), and internally runs a non-deterministic reason→act→observe loop.

## Decision
Two durability layers with clear ownership:

- **Temporal** owns the **Run lifecycle** — one workflow per Run; activities for triage / repo-prep / plan / execute-step / verify / review / deliver; signals for `approvalGranted|Rejected`, `cancel`, `pause`, `resume`, `operatorMessage`; timers for approval SLA and wall-clock budget.
- **LangGraph** owns the **loop inside an agent step** — graph nodes for assemble-context / model-call / parse / guard+dispatch / observe; a Postgres checkpointer after every observe so a single step resumes after a worker crash.

Rule: **no side-effecting work before a LangGraph `interrupt()`** (code before an interrupt may re-run on resume).

## Alternatives rejected
Inngest (TS-only bias, less timeout control), Restate/Hatchet (younger), DBOS (narrower language coverage), BullMQ-only (not a workflow engine). See prd/04 §3.

## Consequences
- Operational weight of a Temporal cluster (server + workers + its own Postgres).
- Deterministic control flow (an LLM never chooses the next step) → auditable and testable.
- `RunOrchestrator` interface keeps Temporal swappable.
