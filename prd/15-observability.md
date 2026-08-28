# 15 — Observability

## 1. Goals

- Every Run is **one distributed trace**; every model call is a `gen_ai.*` span; every tool call is a child span (NFR-OBS-1).
- Answer, in under a minute: *what is this Run doing, why is it slow/expensive, where did it fail, how much did it cost.*
- Fleet-level: queue health, provider health, sandbox pool, cost burn, success rate — all with alerts.
- **OpenTelemetry as the portability standard**; vendors are optional exporters, never a hard dependency.

## 2. Stack

| Signal | Pipeline | Store | UI |
|--------|----------|-------|----|
| Traces | OTel SDK (TS + Python) → OTel Collector → OTLP | **Tempo** (or Jaeger) | Grafana |
| LLM traces / evals | Model Router + Agent Worker → Langfuse SDK | **Langfuse** (self-host) | Langfuse UI |
| Metrics | OTel + Prom client → Collector / scrape | **Prometheus** (+ Mimir/Thanos for long retention) | Grafana |
| Logs | structured JSON → Collector / Promtail | **Loki** | Grafana |
| Events (domain) | `run_event` (Postgres) is the domain-truth timeline; also mirrored to traces | Postgres | Dashboard |
| Cost/token ledger | `model_call` table + materialized views | Postgres | Dashboard Analytics |

Everything ships in the Compose stack; production can redirect OTLP to the customer's existing backend (Datadog/New Relic/Grafana Cloud) with no code change.

## 3. Tracing model

```
span: run  (root)                          run_id, tenant_id, project_id, work_item_id, agent_config_version
  ├─ span: triage                          gen_ai.* (model), verdict
  ├─ span: prep_repo                       repo size, files, embed count, duration
  ├─ span: plan
  │    ├─ span: gen_ai.chat  (Planner)     gen_ai.request.model, usage, cost, finish_reason, attempt
  │    └─ span: tool.code_search / fs.read
  ├─ span: step[3] "add retry policy"      role=coder, iterations
  │    ├─ span: gen_ai.chat (iter 4)       gen_ai.*  + praxis.cache_hit
  │    ├─ span: tool.fs_patch              files, +/- lines, artifact_id
  │    ├─ span: tool.test_run              pass/fail counts, duration, artifact_id
  │    └─ span: approval.wait (if raised)  approval_id, sla, wait_seconds
  ├─ span: verify.unit / verify.e2e        result, artifact_id
  ├─ span: review                          verdict, findings_count
  └─ span: deliver
       ├─ span: tool.git_push              head_sha
       └─ span: tool.vcs_open_pr           pr_number, url
```

### Attribute conventions
- **OTel GenAI semconv** on model spans: `gen_ai.system` (provider), `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`. Plus platform extensions namespaced `praxis.*`: `praxis.run_id`, `praxis.step_id`, `praxis.agent_role`, `praxis.cost_usd`, `praxis.cached_input_tokens`, `praxis.route_attempt`, `praxis.cache_hit`.
- Tool spans: `praxis.tool.name`, `praxis.tool.execution` (sandbox|control), `praxis.tool.risk_tier`, `praxis.tool.status`, `praxis.tool.bytes_out`, `praxis.artifact_id`.
- Trace context propagates: API → Temporal workflow (as a workflow attribute + baggage) → gRPC to agent worker → tool broker → sandbox runner. `trace_id` is stamped on every `run_event`, log line, and Langfuse trace so all four views cross-link.
- Agent-specific OTel spans are still "experimental" upstream — we follow the current shape and isolate the mapping in one module so a spec change is a one-file update.

## 4. Langfuse (LLM lens)

- One Langfuse **trace per Run**, observations per model call and per agent turn: prompt (redacted), response (redacted), model, tokens, cost, latency, tool calls, scores.
- **Scores** attached automatically: verification outcome (pass/fail), reviewer verdict, human-intervention count, "delivered & merged" (from Git webhook), cost bucket. These drive quality dashboards and the golden-task time series.
- **Prompt/config management:** agent prompt packs and `agent_config_version` ids tagged on traces → compare versions' pass rate / cost / latency directly.
- **Datasets = golden tasks:** the eval harness ([17](./17-testing-strategy.md)) runs against Langfuse datasets; results tracked over time; regression gates read from here.
- Retention: 30 days default (or `none` for zero-retention tenants); redacted content only.

## 5. Metrics catalog

### Per service (RED)
`http_requests_total{service,route,method,status}`, `http_request_duration_seconds{...}`, `http_in_flight`, error ratio. gRPC equivalents.

### Runs / orchestration
| Metric | Type | Labels |
|--------|------|--------|
| `praxis_runs_started_total` | counter | project, trigger(auto/manual/api) |
| `praxis_runs_completed_total` | counter | project, outcome, failure_category |
| `praxis_run_duration_seconds` | histogram | project, outcome |
| `praxis_run_active` | gauge | state |
| `praxis_run_step_iterations` | histogram | role |
| `praxis_run_cost_usd` | histogram | project |
| `praxis_run_tokens_total` | counter | project, kind(input/output/cached) |
| `praxis_non_progress_events_total` | counter | kind |
| `praxis_hitl_wait_seconds` | histogram | approval_type |

### Model gateway
`praxis_model_calls_total{provider,model,outcome}`, `praxis_model_tokens_total{provider,model,kind}`, `praxis_model_cost_usd_total{provider,model}`, `praxis_model_latency_seconds{provider,model}`, `praxis_model_route_fallbacks_total{from,to,reason}`, `praxis_model_cache_hits_total{mode}`, `praxis_model_circuit_open{provider,model}` (gauge).

### Sandbox pool
`praxis_sandbox_pool_size{class,state=total|warm|leased|failed}`, `praxis_sandbox_cold_start_seconds{class}`, `praxis_sandbox_lease_duration_seconds`, `praxis_sandbox_egress_bytes_total{project}`, `praxis_sandbox_oom_total`.

### Event bus / queues
`praxis_bus_publish_total{topic_class}`, `praxis_bus_consume_lag_seconds{consumer}`, `praxis_bus_deadletter_total`, `praxis_queue_depth{queue}`, `praxis_queue_oldest_age_seconds{queue}`.

### Connectors
`praxis_connector_health{connector,status}` (gauge), `praxis_connector_ingress_total{connector,event}`, `praxis_connector_webhook_failures_total{connector}`, `praxis_connector_poll_duration_seconds{connector}`.

### Business / cost
`praxis_budget_utilization_ratio{scope,scope_id}`, `praxis_wasted_spend_usd_total{project}` (cost on failed/cancelled Runs), `praxis_pr_merged_total{project}`, `praxis_human_interventions_total{project,kind}`.

## 6. Logging

- **Format:** JSON, one event per line. Mandatory fields: `ts, level, service, msg, trace_id, span_id, tenant_id, run_id?, step_id?, actor?`.
- **Levels:** `error` (actionable), `warn`, `info` (state transitions, external calls), `debug` (opt-in per service/tenant).
- **Never logged:** secret values, raw provider keys, full prompts/responses (those go to Langfuse redacted), PII beyond ids.
- **Correlation:** `trace_id` links logs ↔ traces ↔ Langfuse ↔ `run_event`. A Grafana "Run" dashboard row deep-links all four.
- **Sampling:** logs unsampled; traces tail-sampled (keep 100% of errors, slow, and any Run with an approval or failure; sample 10–20% of fast successful Runs) to control volume while keeping the interesting ones.

## 7. Dashboards (shipped as Grafana JSON)

| Dashboard | Panels |
|-----------|--------|
| **Fleet** | active Runs by state, start/complete rate, success rate, queue depth, open approvals, cost burn (today/month vs budget), provider health strip |
| **Run drill-down** | pick a `run_id`: trace waterfall, per-step duration/cost, model-call table, tool-call table, log stream, artifacts |
| **Model gateway** | RPS + error rate + p95 per provider/model, fallback rate, cache hit rate, circuit states, cost/hour by model, token mix |
| **Sandbox pool** | size/warm/leased, cold-start p95, lease duration, OOMs, egress bytes by project |
| **Queues & bus** | depth, oldest-age, consumer lag, dead-letters, worker autoscale state |
| **Connectors** | health matrix, ingress rate, webhook failures, poll latency, last-seen |
| **Cost & value** | $/day by project & model, wasted spend, $/successful Run, PRs merged, est. hours saved |
| **SLOs** | error budget burn for each SLO (below) |
| **Temporal** | open workflows, task-queue backlog, activity failure/retry rate, worker slots |

## 8. SLOs & alerting (NFR-OBS-5)

| SLO | Target | Alert |
|-----|--------|-------|
| Control-plane API availability | 99.9% monthly (GA) | fast-burn (2%/1h) page; slow-burn (5%/6h) ticket |
| Dashboard event delivery latency | p95 < 750 ms | > 750 ms for 10 min → warn; > 2 s → page |
| Run "not silently lost" | 100% resume-or-fail within 2 min of worker crash | any Run in a non-terminal state with no event > 5 min → page |
| Approval SLA breach | 0 unattended breaches | any open approval within 15 min of SLA → notify approvers again + warn; breach → page on-call + Run flagged |
| Model gateway error rate | < 2% 5-min | > 5% for 5 min → page; all routes for a class unhealthy → page (Runs auto-pause) |
| Sandbox pool exhaustion | warm > 0, leased < 90% | leased ≥ 90% for 5 min → warn + autoscale; = 100% → page |
| Budget burn | — | tenant/project ≥ 80% → notify; ≥ 100% → per policy (block/approve) + notify |
| Queue backlog | oldest job < 5 min | oldest > 10 min → warn; > 30 min → page |
| Event-bus lag | < 2 s | > 10 s for 5 min → warn; > 60 s → page |
| Audit chain integrity | verified daily | chain break → page security |
| Cost anomaly | — | a single Run > 3× its project's 7-day median cost → warn + auto-raise budget approval |

Alert routing: Prometheus Alertmanager → PagerDuty/Opsgenie (page) + Slack (warn) + the dashboard's System Health banner. Every alert links to a runbook.

## 9. Health & readiness

- Every service: `/healthz` (liveness — process up), `/readyz` (readiness — deps reachable: DB, bus, Temporal, secrets). K8s probes wired to these.
- Synthetic canary (per environment): a scheduled "canary Run" against a fixture repo every 30 min; failure or > N-minute duration pages. This is the truest end-to-end signal.
- Startup self-check: config validation, migration version match, provider reachability (warn-only), sandbox backend capability probe (KVM present?).

## 10. Cost observability specifics

- The `model_call` ledger is authoritative; materialized views (`mv_cost_daily_project`, `mv_cost_daily_model`, `mv_run_totals`) refresh on an event trigger, ≤ 1 min lag (NFR-OBS-4).
- Every UI surface showing cost also shows provider + model (FR-DASH-12); the Run "Cost" tab breaks down input/output/cached tokens, per-step cost, fallbacks, cache savings, and budget consumption.
- "Wasted spend" (failed/cancelled Run cost) is a first-class metric and analytics panel — it's the primary signal for tuning agent configs and triage thresholds.
- Monthly cost export (CSV) per tenant for finance reconciliation; optional per-provider invoice cross-check with recorded `costUsd` deltas surfaced.

## 11. Retention (observability data)

| Data | Retention |
|------|-----------|
| Traces (Tempo) | 14 days (30 for error/approval/failed Runs via tail-sampling policy) |
| Metrics (Prometheus) | 15 days raw; 13 months downsampled (Mimir/Thanos) |
| Logs (Loki) | 30 days |
| Langfuse traces | 30 days (redacted; `none` for zero-retention tenants) |
| `run_event` | 90 days hot → S3 archive 12 months ([10](./10-database-architecture.md)) |
| `model_call` ledger | 400 days hot (billing) → 3 years archive |
