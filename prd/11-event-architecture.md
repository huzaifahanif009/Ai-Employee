# 11 — Event Architecture

## 1. Principles

1. **Event-sourced timeline.** Every meaningful thing in a Run is an append-only `run_event` in Postgres. That table is the source of truth; the UI timeline and analytics are projections of it.
2. **Bus is a projection, not the truth.** The message bus (Redis Streams → NATS JetStream) exists for *live fan-out*. If the bus loses a message, the timeline is still correct and clients backfill from Postgres.
3. **One Run = one trace.** Events carry `trace_id`; each maps to an OTel span ([15](./15-observability.md)).
4. **Typed contract.** Event types and payload schemas are versioned (JSON Schema), codegen'd to TS + Python. Consumers ignore unknown types forward-compatibly.
5. **Tenant-scoped topics.** No consumer can subscribe across tenants; the gateway enforces RBAC on subscription.
6. **AG-UI-shaped for the agent stream.** The subset of events the dashboard's live-activity panel consumes follows AG-UI event naming so third parties / CopilotKit-style UIs can consume it too.

## 2. Flow

```
Producers:  Orchestrator (Temporal) · Agent Worker · Model Router · Tool Broker ·
            VCS/Tracker Services · Webhook Ingress · Approval service
     │  1. append  ────────────►  Postgres run_event (seq gap-free per run)  [SOURCE OF TRUTH]
     │  2. publish ────────────►  EventBus topic:  tenant.<tid>.run.<rid>  +  tenant.<tid>.fleet
                                      │
                     ┌────────────────┼───────────────────────────┐
                     ▼                ▼                           ▼
             Realtime Gateway   Analytics consumer         Notification consumer
             (SSE + WS fanout)  (rollups, mat views)       (Slack/email/webhooks)
                     │
              ┌──────┴───────┐
              ▼              ▼
         SSE /streams   WS /control
         (dashboard)    (dashboard, chatops)
```

Append + publish is done in one unit: the producer writes the `run_event` row in the same transaction as its state change, then an **outbox** worker publishes to the bus (transactional outbox pattern → no lost/duplicated publishes on crash).

## 3. `EventBus` interface

```ts
interface EventBus {
  publish(topic: string, event: PlatformEvent): Promise<void>;         // via outbox
  subscribe(topicPattern: string, group: string,
            handler: (e: PlatformEvent, ack: () => void) => void): Subscription;
  // topics: tenant.<tid>.run.<rid> | tenant.<tid>.fleet | tenant.<tid>.approvals | tenant.<tid>.connectors
}
```

Implementations:
- **`redis-streams`** (dev, small prod): one stream per topic, consumer groups, `XAUTOCLAIM` for stuck messages, `MAXLEN ~` trimming (bus is ephemeral; truth is Postgres).
- **`nats`** (scale): JetStream stream per tenant with subject filtering `run.<rid>.>`, durable consumers, ack + redelivery, WorkQueue for notification/analytics consumers, and a short max-age (minutes) since Postgres is the log.

## 4. Event catalog

`PlatformEvent = { id, type, schemaVersion, tenantId, traceId, ts, actor?, ...typed payload }`

### 4.1 WorkItem / intake

| Type | Payload | Emitted when |
|------|---------|--------------|
| `work_item.received` | `{ workItemId, source, externalId, title }` | normalized from webhook/poll/manual |
| `work_item.updated` | `{ workItemId, changes }` | source ticket changed |
| `work_item.triaged` | `{ workItemId, type, size, verdict, questions? }` | triage done |
| `work_item.needs_info` | `{ workItemId, questions[] }` | verdict = needs_info |
| `work_item.rejected` | `{ workItemId, reason }` | not suitable / over threshold |

### 4.2 Run lifecycle

| Type | Payload |
|------|---------|
| `run.created` | `{ runId, workItemId, projectId, agentConfigVersionId, policyVersionId }` |
| `run.state_changed` | `{ runId, from, to }` (queued→planning→…→succeeded/failed/cancelled/timed_out) |
| `run.totals_updated` | `{ runId, tokens, costUsd, toolCalls, filesChanged, wallMs }` (throttled) |
| `run.failed` | `{ runId, category, message, lastGoodStepId? }` |
| `run.completed` | `{ runId, outcome, prUrl?, summaryId }` |

### 4.3 Plan

| Type | Payload |
|------|---------|
| `plan.created` | `{ runId, planId, version, stepCount, filesEstimate[], risk }` |
| `plan.step_defined` | `{ planId, index, title, riskTier }` (stream during planning) |
| `plan.revised` | `{ runId, planId, version, reason }` |

### 4.4 Step / agent activity (AG-UI-shaped)

| Type | AG-UI analogue | Payload |
|------|----------------|---------|
| `run_step.started` | `STEP_STARTED` | `{ runId, stepId, index, role, title }` |
| `run_step.finished` | `STEP_FINISHED` | `{ runId, stepId, state, iterations }` |
| `message.delta` | `TEXT_MESSAGE_CONTENT` | `{ runId, stepId, role, deltaText }` (token stream; batched ~50–100ms) |
| `message.done` | `TEXT_MESSAGE_END` | `{ runId, stepId, messageId }` |
| `tool_call.started` | `TOOL_CALL_START` | `{ runId, stepId, toolCallId, tool, argsPreview, riskTier }` |
| `tool_call.args_delta` | `TOOL_CALL_ARGS` | `{ toolCallId, deltaJson }` (streamed args) |
| `tool_call.finished` | `TOOL_CALL_RESULT` | `{ toolCallId, status, durationMs, bytesOut, outputPreview, artifactId? }` |
| `context.compacted` | — | `{ runId, stepId, beforeTokens, afterTokens }` |
| `progress.warning` | — | `{ runId, stepId, kind: 'non_progress'|'repeated_error'|'oscillation', evidence }` |

### 4.5 Model calls

| Type | Payload |
|------|---------|
| `model_call.started` | `{ runId, stepId, purpose, routingClass, modelHint? }` |
| `model_call.routed` | `{ callId, provider, model, attempt, cacheHit }` |
| `model_call.finished` | `{ callId, inputTokens, outputTokens, costUsd, latencyMs, finishReason }` |
| `model_call.fallback` | `{ callId, fromModel, toModel, reason }` |
| `provider.health_changed` | `{ provider, model, state: healthy|degraded|down }` (fleet topic) |

### 4.6 Verification & review

| Type | Payload |
|------|---------|
| `verify.started` / `verify.check_started` | `{ runId, check: build|lint|unit|integration|e2e }` |
| `verify.check_log` | `{ runId, check, deltaText }` (streamed log) |
| `verify.check_finished` | `{ runId, check, result: pass|fail, summary, artifactId }` |
| `verify.finished` | `{ runId, overall, coverageDelta? }` |
| `review.started` | `{ runId }` |
| `review.finished` | `{ runId, verdict: pass|concerns|block, findings[] }` |

### 4.7 Approvals & HITL

| Type | Payload |
|------|---------|
| `approval.requested` | `{ approvalId, runId, type, evidence, actionPreview, slaAt }` (also → `tenant.<tid>.approvals`) |
| `approval.decided` | `{ approvalId, decision, decidedBy, note }` |
| `approval.expired` | `{ approvalId, runId }` |
| `run.paused` / `run.resumed` | `{ runId, reason, actor? }` |
| `operator.message` | `{ runId, from, text }` (injected guidance) |

### 4.8 Delivery & Git

| Type | Payload |
|------|---------|
| `git.branch.created` | `{ runId, repo, branch, baseSha }` |
| `git.commit.created` | `{ runId, sha, message, filesChanged }` |
| `git.pushed` | `{ runId, repo, branch, headSha }` |
| `vcs.pr.opened` / `vcs.pr.updated` | `{ runId, repo, prNumber, url, state }` |
| `git.pr.merged` | `{ repo, prNumber, runId? }` (from webhook) |
| `git.checks.updated` | `{ repo, prNumber, checks[] }` |

### 4.9 Fleet / system (topic `tenant.<tid>.fleet`)

| Type | Payload |
|------|---------|
| `fleet.counters` | `{ runsByState, activeAgents, openApprovals, queueDepth }` (throttled ≤ 1s) |
| `system.health` | `{ sandboxPool: {total,leased,warm}, busLagMs, modelErrorRate, connectors: [{id,status}] }` |
| `budget.threshold` | `{ scope, scopeId, pct, projectionUsd }` |
| `connector.health_changed` | `{ connectorId, status, detail }` |
| `audit.appended` | `{ action, target }` (for a live audit view; payload minimal) |

## 5. Real-time delivery to the browser

### SSE (`GET /v1/streams/runs/:runId?lastEventId=...`)
- One SSE stream per open Run view; `event:` = the platform event `type`, `id:` = `run_event.seq`, `data:` = JSON payload.
- On connect with `Last-Event-ID` (or `?lastEventId`), the gateway reads `run_event WHERE run_id=? AND seq > ?` from Postgres, flushes the backlog, then attaches to the live bus subscription — **no gap, no dupes** (seq-based).
- Heartbeat comment every 15s; client auto-reconnects (native `EventSource`), gateway is stateless so any instance can serve the reconnect.
- Fleet stream: `GET /v1/streams/fleet` (throttled counters + system health + notable events).
- Token/log streams are coalesced server-side (flush every 50–100ms or 1KB) to bound event rate.

### WebSocket (`/v1/control`)
- Bidirectional, for actions that need a request/response or low-latency input:
  - client→server: `run.pause`, `run.resume`, `run.cancel`, `run.comment`, `approval.decide`, `subscribe`/`unsubscribe` (topic), `presence.ping`.
  - server→client: `ack`, `error`, plus mirrored critical events (`approval.requested`, `run.state_changed`) for clients that prefer one socket.
- Auth: JWT on the upgrade request; RBAC checked per action and per subscribed topic; tenant scoping enforced.
- Presence: who else is viewing a Run (for operator coordination).

### Why both (recap from [04](./04-technology-research.md))
SSE for the high-volume, one-way streams (cheap, CDN/proxy-friendly, trivial reconnect, stateless scale). WS for the low-volume interactive control plane. The dashboard opens one fleet SSE always, one Run SSE per open Run detail, and one shared WS for control.

## 6. Scaling the fan-out

- The **Realtime Gateway** is horizontally scaled; each instance subscribes to the bus with its own consumer name and fans out to its locally connected clients.
- SSE needs **no sticky sessions** (stateless; reconnect + backfill handles instance moves). WS uses sticky routing (or a shared subscription registry in Redis) so control messages reach the right socket.
- Backpressure: per-connection outbound buffer cap; if a slow client overflows, the gateway drops it and the client reconnects + backfills.
- Event volume guardrails: token/arg/log deltas are batched; `run.totals_updated` and `fleet.counters` are throttled; per-Run event rate is capped with overflow summarized (`events.throttled` marker).

## 7. Idempotency, ordering, replay

- **Ordering:** guaranteed per Run via `run_event.seq` (assigned under an advisory lock / per-run sequence). The bus may reorder; consumers that care sort by `seq`. Cross-Run ordering is not guaranteed and not needed.
- **Idempotency:** every event has a stable `id`; consumers (analytics, notifications) dedupe on it. Notification consumer additionally dedupes on `(type, runId, dedupeKey)` to avoid double Slack posts on redelivery.
- **Replay:** analytics/materialized views can be fully rebuilt by streaming `run_event` from Postgres in `seq` order (bounded by retention/archive). A `--replay-from` admin command re-emits to a scratch consumer for backfills.
- **Exactly-once side effects** (PR open, Slack post) are guarded at the action layer with idempotency keys, not assumed from the bus.

## 8. External outbound webhooks (P1)

Tenants can register outbound webhook endpoints subscribed to a filtered event set (`run.completed`, `approval.requested`, …). Delivery: signed (HMAC), retried with exponential backoff, dead-lettered after N attempts, visible in a delivery log. This is how customers wire Praxis into their own systems without polling the API.
