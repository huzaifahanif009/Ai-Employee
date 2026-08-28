# 09 — Integration & Tool Architecture

Two related but distinct systems:

1. **Connectors** — installed integrations with external services (trackers, VCS, ChatOps, CI, doc stores, MCP servers). Configured per Tenant, credentialed, health-checked.
2. **Tools** — the callable capabilities agents use during a Run (`fs.read`, `shell.exec`, `vcs.open_pr`, `slack.post`, plus connector- and MCP-provided tools). Schema'd, risk-tiered, permissioned per Project.

A Connector often *provides* Tools (e.g. the Slack connector provides `slack.post`, `slack.get_thread`).

---

## 1. Connector model

```ts
interface Connector<TContract> {
  id: string;                      // 'jira', 'linear', 'github-issues', 'edap-workdesk', 'slack', ...
  contracts: ContractKind[];       // ['tracker'] | ['vcs'] | ['chatops'] | ['ci'] | ['kv'] | ['mcp']
  configSchema: JSONSchema;        // tenant-supplied config (URLs, project keys, filters)
  authKind: 'oauth2' | 'token' | 'app' | 'basic' | 'none';

  connect(config, secretsRef): Promise<ConnectorInstance>;
  healthCheck(instance): Promise<HealthStatus>;
  provideTools(instance): ToolDefinition[];      // tools this connector exposes to agents
  ingressWebhook?(headers, body): PlatformEvent[]; // if it emits webhooks
  poll?(instance, since): Promise<PlatformEvent[]>; // polling fallback
  teardown(instance): Promise<void>;
}
```

- Instances live in `connectors` ([10](./10-database-architecture.md)); secrets in the secrets manager, referenced by `secretsRef`.
- Health checks run on install and on a schedule; status shows on the dashboard (FR-DASH-8).
- Disabling a Connector stops ingress/polling and disables its Tools immediately (FR-INT-1); history is retained.

### Contract kinds

| Kind | Purpose | Core methods |
|------|---------|--------------|
| **tracker** | Ingest tickets, write status back | `listItems`, `getItem`, `normalize→WorkItem`, `comment`, `transition`, `ingressWebhook`, `poll` |
| **vcs** | See [08](./08-git-provider-abstraction.md) | `VcsProvider` |
| **chatops** | Approvals, notifications, slash commands | `postMessage`, `postApproval(actions)`, `onInteraction`, `resolveUser`, `command` |
| **ci** (P1) | Trigger/read external pipelines | `triggerPipeline`, `getPipeline`, `streamLogs` |
| **kv / docs** (P1) | Read reference docs/wikis for research | `search`, `getDoc` |
| **mcp** | Mount an external MCP server | `listTools`, `listResources`, `callTool`, `readResource` |

---

## 2. Tracker abstraction (`TrackerProvider`)

```ts
interface TrackerProvider {
  id: string;
  listItems(query: TrackerQuery): Promise<TrackerItem[]>;
  getItem(externalId: string): Promise<TrackerItem>;
  normalize(raw: TrackerItem): WorkItemDraft;      // → { title, body, acceptanceCriteria[], labels[], priority, assignee, attachments[], sourceUrl }
  comment(externalId: string, body: string): Promise<void>;
  transition(externalId: string, to: TrackerState, opts?): Promise<void>;  // e.g. In Progress, In Review
  linkPullRequest?(externalId: string, prUrl: string): Promise<void>;
  ingressWebhook?(headers, body): { event: string; items: WorkItemDraft[] };
  poll(since: ISODate): Promise<{ items: WorkItemDraft[]; cursor: string }>;
  capabilities(): { webhooks: bool; transitions: bool; acParsing: bool; attachments: bool };
}
```

### Connectors at each phase

| Connector | Auth | Ingest | Write-back | Phase |
|-----------|------|--------|-----------|-------|
| **GitHub Issues** | GitHub App | webhook (`issues`, `issue_comment`) + poll | comment, close, link PR, labels | MVP (P0) |
| **EDAP Workdesk** | JWT service account against `edap-ticketing-service` `/api/*`; subscribe to `/workdesk` Socket.io (`task.created/updated`, `comment.created`) | socket events + REST poll | comment (`POST /tasks/:id/comments`), status transition, attach PR link in activity | MVP (P0) |
| **Jira** (Cloud + DC) | OAuth 2.0 (3LO) / API token | webhook + JQL poll | comment, transition, remote link | Beta (P1) |
| **Linear** | OAuth / API key | webhook (GraphQL subscriptions or webhook) + poll | comment, state change, attachment link | Beta (P1) |
| **Azure DevOps Boards** | PAT / OAuth | service hooks + poll | comment, state | GA (P2) |
| **Generic/CSV/Email-in** | token / mailbox | poll / inbound email parse | none / email reply | GA (P2) |

### EDAP Workdesk connector specifics
- Reads: `GET /api/internal/tasks?...` for candidate tasks; maps Workdesk `Task` (title, description, `taskNumber`, priority, assignees, `list_id`, status, checklists, comments, attachments) → `WorkItemDraft`. Acceptance criteria parsed from the description body and from checklist items.
- Intake filter: Workdesk `list_id` allowlist + a tag (e.g. `praxis`) + assignee = the Praxis bot user.
- Realtime: maintains a Socket.io client on `/workdesk` (JWT handshake, same pattern as the Angular `RealtimeService`) to get `task.updated` / `comment.created` without polling lag.
- Write-back: `run.delivered` → `POST /tasks/:id/comments` with the PR link + summary, and `transition` to the Workdesk status configured as "In Review"; on `git.pr.merged` → transition to "Done".
- No schema changes to Workdesk; everything through its existing REST + socket surface.

---

## 3. ChatOps abstraction

```ts
interface ChatOpsProvider {
  postMessage(channel, blocks): Promise<MsgRef>;
  updateMessage(ref, blocks): Promise<void>;
  postApproval(channel, approval: ApprovalCard): Promise<MsgRef>;   // renders Approve/Reject actions
  onInteraction(payload): ChatInteraction;                          // button click → { approvalId, decision, actorExternalId }
  resolveUser(externalId): Promise<PlatformUserId | null>;          // map Slack user → Praxis user for RBAC
  command(payload): SlashCommand;                                   // '/praxis status <run>' etc.
}
```

- **Slack** (MVP): approvals with buttons, Run status cards, `/praxis` slash command (`status`, `start <ticket>`, `cancel <run>`, `approvals`), thread updates on state changes. Button clicks are verified (signing secret), mapped to a Praxis user, RBAC-checked, then applied as an approval decision (recorded with the resolved actor).
- **MS Teams**, **Discord** (Beta): same contract.
- Notification routing: per Project, choose channels for `approval_requested`, `run_failed`, `run_delivered`, `budget_warning`.

---

## 4. Tool system

### Tool definition

```ts
interface ToolDefinition {
  name: string;                         // 'fs.read', 'shell.exec', 'vcs.open_pr', 'slack.post', 'mcp:<server>/<tool>'
  description: string;                   // shown to the model
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  execution: 'sandbox' | 'control-plane';
  riskTier: 'auto' | 'notify' | 'approve' | 'forbidden';   // default; Policy may raise (never lower below platform min)
  idempotent: boolean;
  scopes: string[];                     // permission scopes required (e.g. 'repo:write', 'chat:post')
  rateLimit?: { perRun?: number; perMinute?: number };
  timeoutMs: number;
  redactOutput?: boolean;               // scrub secrets from result before it re-enters context
  untrustedOutput?: boolean;            // wrap result as untrusted data (web.fetch, tracker bodies)
}
```

### Native tool catalog (v1)

| Tool | Exec | Risk | Notes |
|------|------|------|-------|
| `repo.map` | sandbox | auto | returns cached structural map |
| `code.search` | sandbox | auto | ripgrep; `--semantic` hits pgvector |
| `fs.read` | sandbox | auto | line-range aware; size-capped |
| `fs.list` | sandbox | auto | |
| `fs.write` / `fs.patch` | sandbox | notify | Policy path checks; unified-diff apply for `patch` |
| `fs.delete` | sandbox | notify (approve if > N files) | |
| `shell.exec` | sandbox | notify (approve if not in command allowlist) | egress per Project policy; output streamed + Artifact |
| `test.run` | sandbox | auto | Project test command(s); structured results |
| `build.run` / `lint.run` | sandbox | auto | |
| `git.*` | sandbox | see [08](./08-git-provider-abstraction.md) | |
| `web.search` | control-plane | notify | allowlisted engines; `untrustedOutput` |
| `web.fetch` | control-plane | approve (unless host allowlisted) | `untrustedOutput`, size cap |
| `vcs.open_pr` | control-plane | approve | idempotent per (run, branch) |
| `vcs.pr_comment` | control-plane | approve | |
| `tracker.comment` / `tracker.transition` | control-plane | approve | |
| `slack.post` | control-plane | notify | to configured channels only |
| `memory.read` | control-plane | auto | |
| `memory.write` | control-plane | notify (auto for allowlisted kinds) | proposals unless Policy auto-accepts |
| `approval.request` | control-plane | auto | agent explicitly asks a human a question |

### Tool Broker

- Central registry: native tools + connector-provided tools + mounted MCP tools.
- On each call: validate input schema → resolve effective risk tier (max of tool default and Policy) → check Project enablement (FR-INT-8) and agent scopes → rate-limit → dispatch → record `tool_call` row + events → post-process (truncate, redact, wrap untrusted).
- `approve`-tier: does **not** dispatch; returns a `needs_approval` sentinel to the graph, which triggers the HITL gate ([06](./06-agent-architecture.md) §5).
- `forbidden`: hard error, logged as a policy event, may pause the Run for review.

---

## 5. MCP integration

### As MCP **client** (P1)

- Admin registers an MCP server per Tenant: `{ name, transport: 'stdio'|'http', endpoint, auth: oauth2|token, scopes }`. Remote servers use **OAuth 2.1** (spec 2026-07-28: PRM discovery per RFC 9728, `iss` validation per RFC 9207, DCR with `application_type`).
- On connect: enumerate `tools`, `resources`, `prompts`. Admin assigns specific tools to Projects and sets each tool's risk tier (default `approve` for any MCP tool until reviewed).
- At Run time, mounted MCP tools appear in the agent's toolset as `mcp:<server>/<tool>`; calls go through the Tool Broker's MCP client; results are `untrustedOutput` by default; token usage / latency recorded.
- Resource reads (`mcp:<server>://<uri>`) are available to Researcher/Planner as context sources, size-capped and untrusted-wrapped.
- Failure/timeout of an MCP server degrades gracefully: the tool is marked unavailable for the Run, logged, agent informed.

### As MCP **server** (P2)

- Praxis exposes a small, RBAC-scoped surface over streamable HTTP + OAuth 2.1:
  - tools: `list_work_items`, `get_run`, `get_run_events`, `start_run`, `post_run_comment`, `list_approvals`.
  - resources: `praxis://runs/{id}`, `praxis://work-items/{id}`.
- Lets external agents/IDEs (Claude Code, Cursor, etc.) query and kick off Praxis work. Every call is audited and rate-limited; `start_run` respects the same policies/budgets as the UI.

---

## 6. Extensibility (P2) — out-of-tree connectors & tools

- A connector/tool is an npm or PyPI package exporting the contract implementation + a manifest (`praxis.connector.json`: id, contracts, configSchema, authKind, permissions).
- Loaded via a config-listed module path; validated at boot (schema + version compat) and gated by the **contract test suite** (published as a runnable package).
- Sandboxing of third-party connector code: connector logic runs in the control plane but in a restricted worker (no filesystem, egress allowlist, CPU/mem caps); anything heavier must be an MCP server instead.
- A **catalog page** lists first-party + installed third-party connectors with health, version, and the Projects using them.

---

## 7. Connector/Tool lifecycle & governance

| Stage | Control |
|-------|---------|
| Install | Owner/Admin only; config validated; health check must pass |
| Credential rotation | via secrets manager; connector `reconnect()` picks up new refs without downtime |
| Enable per Project | Admin toggles connector + individual tools (FR-INT-8) |
| Risk-tier override | Maintainer may raise a tier; lowering below platform minimum is refused |
| Audit | install, config change, enable/disable, credential access, every tool call — all in the audit log |
| Removal | disables tools/ingress immediately; data retained per policy; secrets purged |
