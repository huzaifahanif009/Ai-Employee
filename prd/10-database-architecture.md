# 10 — Database Architecture

## 1. Datastore inventory

| Store | Purpose | Notes |
|-------|---------|-------|
| **PostgreSQL 16+** (`praxis` DB) | System of record: tenancy, projects, work items, runs, steps, tool calls, approvals, policies, connectors, agents, budgets, ledger, audit, events | JSONB for raw payloads/plans; partitioning on hot tables; RLS for tenant isolation |
| **PostgreSQL + `pgvector`** | Code/doc embeddings, semantic memory | Same cluster initially; `VectorStore` interface allows moving to **Qdrant** |
| **PostgreSQL** (`temporal` DB) | Temporal server persistence | Separate DB/instance; not app-shared |
| **Redis 7+** | Cache, locks, BullMQ queues, Redis Streams bus (dev), sandbox pool state, rate limiters, exact-response cache | Not a system of record |
| **S3-compatible** (MinIO/cloud) | Artifacts: diffs/patches, full tool outputs, build/test/e2e logs, coverage, screenshots, context snapshots | Versioned buckets; lifecycle rules per retention policy |
| **Prometheus / Tempo / Loki / Langfuse** | Metrics / traces / logs / LLM traces | Observability, not domain state ([15](./15-observability.md)) |

Design rule: **Postgres is the source of truth for the Run timeline** (`run_events`); the event bus is a projection for live delivery ([11](./11-event-architecture.md)).

## 2. Entity-relationship overview

```
tenant 1─┬─* user
         ├─* membership (user×tenant×role)
         ├─* connector ───────────────* connector_event (raw ingress log)
         ├─* project ─┬─* work_item ─┬─* run ─┬─* run_step ─┬─* tool_call ──* artifact
         │            │             │        │             └─* model_call (ledger)
         │            │             │        ├─* plan (versioned) ──* plan_step
         │            │             │        ├─* approval
         │            │             │        ├─* run_event   (append-only timeline)
         │            │             │        └─* run_summary  (1:1 on completion)
         │            │             └─* work_item_comment_mirror
         │            ├─* agent_config ──* agent_config_version
         │            ├─* policy (versioned)
         │            ├─* project_memory (typed facts)
         │            ├─* code_embedding (pgvector)  [key: project_id, ref, path, chunk]
         │            └─* budget (tenant/project/run scopes)
         └─* audit_log (append-only, hash-chained)
```

## 3. Core tables (abridged DDL intent)

> Types shown for intent; TypeORM entities (app) generate the real migrations. All tables: `id uuid pk default gen_random_uuid()`, `tenant_id uuid not null` (except `tenant`), `created_at timestamptz`, `updated_at timestamptz`. RLS policy `tenant_id = current_setting('praxis.tenant')::uuid`.

### tenancy & identity
```
tenant(id, name, slug, plan, settings jsonb, retention jsonb, created_at)
user(id, email citext unique, name, password_hash?, sso_subject?, avatar_color, status, last_login_at)
membership(id, tenant_id, user_id, role enum[owner,admin,maintainer,operator,viewer], created_at, unique(tenant_id,user_id))
service_account(id, tenant_id, name, kind enum[ci,webhook,git-bot,mcp], scopes text[], secret_ref, disabled bool)
```

### projects & config
```
project(id, tenant_id, name, slug, vcs_connector_id fk, repo_ref jsonb, base_branch,
        path_scope?, verify_pipeline jsonb, intake jsonb, branch_template,
        default_agent_config_id fk, policy_id fk, created_by, archived_at?)
project_tracker_source(id, project_id, connector_id fk, config jsonb, filter jsonb, enabled bool)
agent_config(id, tenant_id, project_id?, name, roles jsonb /* role→{modelBinding,toolset,promptPackRef,contextStrategy,guards} */,
             current_version_id fk)
agent_config_version(id, agent_config_id, version int, spec jsonb, prompt_packs jsonb, created_by,
                     eval_summary jsonb?, promoted bool, created_at)
policy(id, tenant_id, project_id?, version int, rules jsonb /* paths, cmd allowlist, egress, risk tier overrides,
       max files, protected branches, memory auto-accept */, created_by, promoted bool)
```

### connectors
```
connector(id, tenant_id, kind, name, contracts text[], config jsonb, secret_ref, auth_kind,
          status enum[healthy,degraded,down,disabled], last_health_at, health_detail jsonb)
connector_event(id, tenant_id, connector_id, external_id, kind, received_at, signature_ok bool,
                dedupe_key unique, payload jsonb, processed_at?, result jsonb)   -- partitioned monthly
```

### work items & runs
```
work_item(id, tenant_id, project_id, source_connector_id, external_id, external_url,
          title, body_md, acceptance_criteria jsonb, labels text[], priority, assignee_ext,
          attachments jsonb, raw jsonb, state enum, triage jsonb /* type,size,verdict,questions */,
          dedupe_key unique(project_id, source_connector_id, external_id), created_at)

run(id, tenant_id, project_id, work_item_id, seq int /* per work_item */,
    state enum, failure_category?, agent_config_version_id fk, policy_version_id fk,
    sandbox_id?, branch_name?, base_sha?, head_sha?, pr_ref jsonb?,
    budget_snapshot jsonb, totals jsonb /* tokens, cost_usd, tool_calls, files_changed, wall_ms */,
    temporal_workflow_id, temporal_run_id,
    started_at, ended_at, created_by)

run_step(id, tenant_id, run_id, plan_step_id?, index int, role enum, title,
         state enum, iterations int, started_at, ended_at, error jsonb?,
         totals jsonb /* tokens, cost, tool_calls */)

plan(id, tenant_id, run_id, version int, summary_md, risk jsonb, files_estimate text[],
     test_strategy_md, raw jsonb, created_by /* agent|user */, approved_by?, approved_at?)
plan_step(id, plan_id, index int, title, rationale_md, files text[], kind, risk_tier)

tool_call(id, tenant_id, run_id, run_step_id, seq int, tool_name, execution enum,
          input jsonb, input_hash, output_preview text, output_artifact_id?,
          status enum[ok,error,denied,needs_approval], risk_tier, duration_ms,
          bytes_out int, idempotency_key?, created_at)          -- partitioned monthly

model_call(id, tenant_id, run_id?, run_step_id?, agent_role, purpose,
           provider, model, input_tokens, output_tokens, cached_input_tokens,
           cost_usd numeric(12,6), latency_ms, cache_hit enum[none,exact,semantic],
           route_attempts jsonb, finish_reason, created_at)      -- partitioned monthly; the cost ledger

artifact(id, tenant_id, run_id, run_step_id?, kind enum[diff,patch,test_report,build_log,e2e_log,
         coverage,screenshot,context_snapshot,pr_body,other], s3_key, bytes, sha256, meta jsonb, created_at)
```

### approvals
```
approval(id, tenant_id, run_id, run_step_id?, type enum[plan,risky_action,budget,review_block,policy_exception,non_progress],
         state enum[open,approved,rejected,expired,auto_resolved], evidence jsonb, action_preview jsonb,
         sla_at timestamptz, requested_at, decided_at?, decided_by?, decision_note, channel enum[dashboard,slack,api])
```

### events & audit
```
run_event(id bigint identity, tenant_id, run_id, seq int /* monotonic per run */, type text,
          payload jsonb, actor jsonb?, ts timestamptz, schema_version int)   -- partitioned monthly; PK (run_id, seq)
audit_log(id bigint identity, tenant_id, actor jsonb, action text, target jsonb,
          before jsonb?, after jsonb?, ts timestamptz, prev_hash bytea, hash bytea)  -- hash-chained, append-only
```

### memory & vectors
```
project_memory(id, tenant_id, project_id, kind enum[repo_fact,convention,run_outcome,pitfall],
               key text, value_md, source enum[agent,human,curator], status enum[proposed,accepted,rejected],
               confidence real, evidence jsonb, accepted_by?, created_at, unique(project_id,kind,key))
run_summary(id, tenant_id, run_id unique, outcome, what_changed_md, files text[], lessons_md,
            metrics jsonb, embedding vector(1536))
code_embedding(id, tenant_id, project_id, ref, path, symbol?, start_line, end_line,
               content_hash, embedding vector(1536), created_at,
               unique(project_id, ref, path, start_line))          -- ivfflat/hnsw index
```

### budgets
```
budget(id, tenant_id, scope enum[tenant,project,run], scope_id uuid,
       period enum[monthly,per_run], limits jsonb /* usd, tokens, wall_ms, iterations, tool_calls, files */,
       soft_pct int default 80, spent jsonb, reserved jsonb, resets_at?, on_breach enum[approve,block])
```

## 4. Partitioning, indexing, retention

| Table | Strategy |
|-------|----------|
| `run_event`, `tool_call`, `model_call`, `connector_event` | **Range-partition by month** on `created_at`/`ts`; detach + archive to S3 (Parquet) past retention; drop old partitions |
| `run_event` | PK `(run_id, seq)`; index `(tenant_id, ts)`; the live timeline reads by `run_id` |
| `model_call` | Indexes `(tenant_id, created_at)`, `(project_id, created_at)`, `(model, created_at)`; **materialized views** `mv_cost_daily_project`, `mv_cost_daily_model`, `mv_run_totals`, refreshed via `REFRESH ... CONCURRENTLY` on an event-driven trigger (≤ 1 min) |
| `run` | Indexes `(tenant_id, state)`, `(project_id, started_at)`, `(work_item_id, seq)` |
| `approval` | Partial index `WHERE state='open'` for the inbox; index `(tenant_id, sla_at) WHERE state='open'` |
| `audit_log` | Append-only; monthly partitions; never updated/deleted; export job to S3 |
| `code_embedding` | HNSW index per `(project_id, ref)`; pruned when a ref is no longer referenced by an active Run + grace period |

**Retention (per-Tenant configurable, defaults):**

| Data | Default retention | Then |
|------|-------------------|------|
| `run_event`, `tool_call` detail | 90 days hot | archived to S3 12 months, then deleted |
| `model_call` ledger rows | 400 days hot (billing) | archived 3 years |
| Artifacts (logs, diffs) | 60 days | deleted; PR body + diff kept 1 year |
| Context snapshots (may contain code) | 14 days | deleted |
| Model prompt/response traces (Langfuse) | 30 days | deleted (or `none` if Tenant sets no-retention) |
| `audit_log` | 2 years hot, 7 years archived | tamper-evident export retained |
| `run_summary` / `project_memory` | indefinite (until Project deleted) | — |

**Hard delete (NFR-COMP-2):** a Tenant delete request runs a purge job across Postgres (all `tenant_id` rows incl. partitions), S3 (prefix delete), pgvector, Redis keys, and issues Langfuse/trace deletions; produces a signed completion record in `audit_log`.

## 5. Tenant isolation (defense in depth)

1. Every query goes through a NestJS **repository wrapper** that injects `tenant_id` and sets `SET LOCAL praxis.tenant = $tenantId` per transaction.
2. **PostgreSQL RLS** policies on every tenant-scoped table as a backstop.
3. Cross-tenant object id → repository returns null → API returns **404** (no 403 existence leak).
4. Object storage keys are prefixed `tenant/<id>/...`; signed URLs are per-object, short-TTL, and checked against the caller's tenant.
5. Vector queries always filter `project_id ∈ caller's tenant`.

## 6. Migrations

- **App tables:** TypeORM migrations, versioned, reversible, run as a pre-deploy K8s Job / Compose init container. **Expand/contract** only — no destructive change deployed in the same release that stops using a column.
- **Python-owned tables** (if the Agent Worker owns any, e.g. embedding bookkeeping): Alembic, same discipline; ideally the Agent Worker owns *no* schema and writes via the control-plane API/gRPC to keep one migration owner.
- **Seed:** idempotent seed script creates roles, default model catalog, policy presets (Conservative/Balanced/Autonomous), a demo Tenant + Project + sample WorkItem (used by `docker compose` demo).
- CI runs `migrate up` then `migrate down` then `up` on a scratch DB to prove reversibility.

## 7. Backups & DR

- Postgres: continuous WAL archiving + nightly base backup; **PITR** target RPO ≤ 5 min, RTO ≤ 30 min (reference deploy). Restore drill each phase, documented.
- Temporal DB: same regime; losing it loses in-flight orchestration → treated as tier-1.
- S3: versioned + cross-region replication (prod); MinIO local has no DR expectation.
- Redis: not backed up (rebuildable); queues use `BullMQ` with Postgres-side idempotency so a Redis loss cannot double-execute delivery.
- A documented **"rebuild from Postgres"** procedure: given the app DB + S3, re-derive aggregates/materialized views and resume Temporal workflows.

## 8. Data-model invariants (enforced by constraints + service checks)

- A `run` always references an `agent_config_version` and a `policy` version (immutable for that Run's lifetime — reproducibility).
- `run_event.seq` is gap-free per `run` (assigned by the orchestrator via an advisory lock / sequence).
- A delivery action (`vcs.open_pr`) has exactly one successful `tool_call` per `(run_id, head branch)` — enforced by a unique partial index on `idempotency_key`.
- `approval.state='open'` implies its `run.state` is a waiting state; a resolver transition updates both atomically.
- `model_call.cost_usd` is never null; cache hits write `0`.
- `audit_log.hash = H(prev_hash || canonical(row))`; a verifier job checks the chain daily.
