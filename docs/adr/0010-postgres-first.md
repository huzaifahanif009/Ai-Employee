# ADR-0010 — Postgres + pgvector first; NATS/Qdrant/Kafka only on proven need

**Status:** Accepted · **Date:** 2026-08-28 · **Refs:** prd/04 §8–9, prd/10

## Context
Avoid premature operational sprawl while keeping scale paths open.

## Decision
- **PostgreSQL 16+** is the system of record: tenancy, projects, work items, runs, steps, tool calls, approvals, policies, connectors, agents, budgets, the `model_call` cost ledger, `run_event` timeline, hash-chained audit. JSONB for raw payloads/plans. Range-partition hot tables by month.
- **pgvector** for embeddings/semantic memory first; `VectorStore` interface allows moving to **Qdrant** if recall latency/scale demands.
- **Redis** for cache, locks, BullMQ, Redis Streams bus (dev/small), sandbox pool state, rate limiters.
- **EventBus** interface: `memory` (tests) → `redis-streams` (dev/small) → **NATS JetStream** (scale). **Kafka** only if a customer needs multi-DC replay at high volume.
- **S3 API** (MinIO local) for artifacts.
- Temporal gets its **own** Postgres, not the app DB.

## Consequences
- One database to operate initially; migrations (TypeORM, expand/contract) are the only schema-change path.
