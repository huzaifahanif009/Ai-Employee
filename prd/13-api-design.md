# 13 — API Design

## 1. Conventions

- **Base:** `https://<host>/api/v1`. Version in the path. Breaking changes → `/api/v2`; one minor-version overlap of support.
- **Style:** resource-oriented REST + JSON. gRPC for internal control-plane ↔ agent-worker only (not public).
- **Auth:** `Authorization: Bearer <jwt>` (user session or service-account token). See [14](./14-security.md).
- **Tenancy:** derived from the token; never a URL/body param. Cross-tenant id → `404`.
- **IDs:** UUID v7 (time-sortable) as strings.
- **Timestamps:** ISO-8601 UTC (`2026-08-28T10:04:12.531Z`).
- **Casing:** `camelCase` JSON fields.
- **Idempotency:** `Idempotency-Key` header required on `POST` that create side effects (start run, decide approval, create work item); server stores key→result for 24h.
- **Pagination:** cursor-based. `?limit=50&cursor=<opaque>` → `{ data: [...], nextCursor: string|null }`. `limit` max 200.
- **Filtering/sort:** explicit query params per resource (documented), not a query DSL. `sort=-createdAt`.
- **Partial responses:** `?fields=` (top-level allowlist) for large resources.
- **Rate limits:** per token + per tenant; `429` with `Retry-After` and `RateLimit-*` headers.
- **Errors:** RFC 9457 Problem Details:
  ```json
  { "type": "https://praxis.dev/errors/budget-exceeded", "title": "Run budget exceeded",
    "status": 409, "detail": "Hard USD limit $5.00 reached", "instance": "/runs/018f.../",
    "code": "BUDGET_EXCEEDED", "meta": { "runId": "018f...", "limit": 5.0, "spent": 5.02 } }
  ```
- **OpenAPI 3.1** generated from the NestJS decorators; published at `/api/v1/openapi.json`; SDKs generated from it.
- **Deprecation:** `Deprecation` + `Sunset` headers; changelog endpoint `/api/v1/meta/changelog`.

## 2. Resource map

```
/auth        login, refresh, logout, me
/tenants     (owner) settings, retention, delete-request
/members     list, invite, role change, deactivate
/service-accounts   CRUD, rotate secret
/providers   AI providers: CRUD, test-call, catalog, role defaults, fallback chains
/connectors  CRUD, health, reconnect, provided-tools
/mcp-servers register, list tools/resources, assign
/projects    CRUD, readiness-check, tracker-sources, verify-pipeline
/agent-configs        CRUD, versions, diff, promote, shadow-run
/policies    CRUD, versions, presets, platform-maxima
/work-items  list, get, create (manual), post-questions, start-run
/runs        list, get, create(start), cancel, pause, resume, comment, retry, resume-from-step
/runs/:id/plan          get, approve, reject, request-replan
/runs/:id/steps         list, get
/runs/:id/tool-calls    list, get (+ artifact links)
/runs/:id/model-calls   list (ledger), summary
/runs/:id/artifacts     list, download (signed URL)
/runs/:id/events        list (paged, seq-ordered)  ← timeline/history
/approvals   list (inbox), get, decide
/budgets     get/set (tenant/project), usage
/analytics   throughput, success-rate, duration, cost, taxonomy, value-estimate
/system      health, sandbox-pool, queues, bus, temporal
/audit       list, export, verify-chain
/streams     SSE endpoints (see §5)
/webhooks/in/:connector   inbound (unauthenticated by JWT; signature-verified)
/webhooks/out             outbound endpoint registry + delivery log
/meta        openapi.json, changelog, version, capabilities
```

## 3. Key endpoints (selected contracts)

### Start a Run
```
POST /api/v1/runs
Idempotency-Key: <uuid>
{
  "workItemId": "018f...",          // or "workItem": { inline draft } for manual
  "projectId": "018f...",
  "agentConfigId": "018f...",       // optional; else project default
  "policyId": "018f...",            // optional; else project default
  "budgetOverride": { "usd": 8, "iterations": 16 },  // optional; within tenant maxima
  "autoApprove": { "plan": false, "delivery": false }, // optional; capped by policy
  "priority": "normal"
}
→ 201 { "run": { "id", "state": "queued", "workItemId", "projectId", "createdAt" } }
409 BUDGET_EXCEEDED | 422 PROJECT_NOT_READY | 403 RBAC
```

### Decide an approval
```
POST /api/v1/approvals/:id/decision
Idempotency-Key: <uuid>
{ "decision": "approve" | "reject" | "request_replan" | "grant_budget" | "deliver_anyway",
  "note": "…",                       // required for reject / override / policy_exception
  "grant": { "usd": 3 } }            // for grant_budget
→ 200 { "approval": { "id", "state", "decidedBy", "decidedAt" } }
409 ALREADY_DECIDED | 410 EXPIRED | 403 RBAC (role or not an approver for this project)
```

### Run control
```
POST /api/v1/runs/:id/pause      { "reason": "…" }            → 202
POST /api/v1/runs/:id/resume                                   → 202
POST /api/v1/runs/:id/cancel     { "reason": "…" }            → 202
POST /api/v1/runs/:id/comment    { "text": "focus on the retry count" }  → 202
POST /api/v1/runs/:id/retry      { "from": "scratch" | "last_good_step" } → 201 (new run)
```
Control actions are also available on the WS `/v1/control` channel for low latency; REST is the durable fallback and is what ChatOps uses.

### List runs (dashboard queue)
```
GET /api/v1/runs?state=executing,verifying&projectId=…&model=…
   &createdAfter=…&hasOpenApproval=true&sort=-createdAt&limit=50&cursor=…
→ 200 { "data": [ { "id","seq","workItem": {"id","title"}, "projectId",
        "state","currentStep": {"index","total","title","role"},
        "models": ["anthropic/claude-…","openai/…"],
        "totals": {"tokens","costUsd","toolCalls","filesChanged","wallMs"},
        "pr": {"number","url","state","checks":"passing"}, "createdAt" } ],
     "nextCursor": null }
```
(The **Dashboard BFF** exposes fatter aggregate endpoints like `GET /bff/overview`, `GET /bff/runs/:id/detail` that assemble multiple resources for a screen in one call.)

### Run events (timeline / history / SSE backfill)
```
GET /api/v1/runs/:id/events?afterSeq=1240&limit=200&types=tool_call.finished,run_step.started
→ 200 { "data": [ { "seq","type","ts","payload","actor?" } ], "nextCursor": "seq:1440" }
```

### Analytics
```
GET /api/v1/analytics/cost?window=30d&groupBy=model&projectId=…
→ 200 { "series": [ { "key":"anthropic/claude-…","points":[["2026-08-01",42.10],…],"total":812.44 } ],
        "wastedSpendUsd": 96.30, "successfulRunAvgUsd": 1.42 }
```

## 4. gRPC (internal only)

`AgentRuntime` service (control plane ↔ Python agent worker):
```
rpc RunTriage(TriageReq) returns (TriageResult)
rpc BuildRepoMap(RepoMapReq) returns (RepoMapResult)
rpc RunPlan(PlanReq) returns (stream AgentEvent)          // streams message/tool events; ends with PlanResult
rpc ExecuteStep(StepReq) returns (stream AgentEvent)      // streams; may end with NeedsApproval
rpc ResumeStep(ResumeReq) returns (stream AgentEvent)     // after approval/guidance
rpc RunReview(ReviewReq) returns (ReviewResult)
```
- `AgentEvent` mirrors the platform event catalog ([11](./11-event-architecture.md)) so the orchestrator just re-publishes.
- Deadlines on every RPC; the orchestrator (Temporal activity) owns retries.
- mTLS between planes; the worker cannot call back into any other control-plane service.

`ToolBroker` service (agent worker ↔ tool broker) and `SandboxProvider` service (broker ↔ runner) similarly proto-defined.

## 5. Real-time endpoints

### SSE
```
GET /api/v1/streams/runs/:id            (Accept: text/event-stream)
    Last-Event-ID: 1240                  (or ?lastEventId=1240)
→ event: tool_call.finished
  id: 1241
  data: {"runId":"…","toolCallId":"…","status":"ok","durationMs":30,"outputPreview":"…"}

GET /api/v1/streams/fleet                (throttled counters + system.health + notable events)
GET /api/v1/streams/approvals            (open-approval add/remove/decide)
```
- Backfill from `run_event` on connect, then live. Heartbeat comment every 15s. Stateless; any gateway instance serves reconnects.

### WebSocket
```
wss://<host>/api/v1/control
  → { "op":"subscribe", "topic":"run:018f..." }
  → { "op":"run.pause", "runId":"018f...", "reason":"…", "reqId":"…" }
  ← { "op":"ack", "reqId":"…" }
  ← { "op":"event", "topic":"run:018f...", "event": { …platform event… } }
```
- JWT on upgrade; RBAC per op and per subscribed topic; presence broadcast per Run.

## 6. Webhooks

**Inbound** `POST /api/v1/webhooks/in/:connectorInstanceId` — no bearer auth; verified by the connector's signature scheme (`X-Hub-Signature-256`, GitLab token, Slack signing secret, Bitbucket). Dedupe by delivery id. Fast `2xx` then process async (enqueue). Bad signature → `401` + audit event.

**Outbound** (P1) — tenant registers `{ url, secret, events: ["run.completed","approval.requested",…] }`. Deliveries HMAC-signed (`X-Praxis-Signature`), `t=<ts>` anti-replay, retried with backoff (1m,5m,30m,2h,6h), dead-lettered after 6 attempts, visible in `GET /webhooks/out/deliveries`.

## 7. SDKs

- **TypeScript** and **Python** clients generated from OpenAPI + hand-written helpers for SSE/WS and pagination iterators.
- Example (TS):
  ```ts
  const praxis = new PraxisClient({ baseUrl, token });
  const run = await praxis.runs.start({ workItemId, projectId }, { idempotencyKey });
  for await (const ev of praxis.runs.stream(run.id)) {
    if (ev.type === "approval.requested") { /* … */ }
  }
  ```
- CLI (`praxis`) wraps the SDK: `praxis run start --work-item …`, `praxis approvals`, `praxis run watch <id>`.

## 8. Compatibility & governance

- Every response includes `X-Praxis-Api-Version` and `X-Praxis-Schema-Version` (event payloads).
- New fields are additive; removals go through deprecation headers + changelog + a ≥ 90-day window.
- Contract tests (Pact-style) between the dashboard, SDKs, and the API run in CI.
- `GET /api/v1/meta/capabilities` advertises enabled features (which connectors, MCP client/server on/off, auto-merge availability) so clients adapt.
