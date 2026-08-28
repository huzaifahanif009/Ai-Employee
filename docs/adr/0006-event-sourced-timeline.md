# ADR-0006 — Event-sourced Run timeline in Postgres; the bus is a projection

**Status:** Accepted · **Date:** 2026-08-28 · **Refs:** prd/11

## Context
The dashboard must render live agent activity with no faked data, survive reconnects with no gaps/dupes, and analytics must be rebuildable.

## Decision
Every meaningful state change appends a typed `run_event` row (gap-free `seq` per Run) **in the same transaction** as the state change. A transactional **outbox** worker publishes to the message bus (`EventBus`: `memory` → `redis-streams` → `nats`). The bus is for live fan-out only; if it drops a message the timeline is still correct and clients backfill from `run_event` by `seq` / `Last-Event-ID`.

## Consequences
- Write amplification (row + outbox) per event — acceptable at target volume; deltas are batched.
- Analytics/materialized views are pure projections, fully replayable.
- SSE reconnection is trivial and correct.
