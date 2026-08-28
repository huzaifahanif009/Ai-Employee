# 00 — Glossary

Shared vocabulary. Every other document uses these terms precisely.

## Domain objects

| Term | Definition |
|------|------------|
| **WorkItem** | The platform's normalized representation of an inbound unit of work, mapped from an external ticket (Jira issue, Linear issue, GitHub Issue, EDAP Workdesk task, or manual). Immutable source fields + platform-managed lifecycle fields. |
| **Run** | One end-to-end attempt to deliver a WorkItem: plan → execute → verify → deliver. A WorkItem can have multiple Runs (retry, re-plan). A Run maps 1:1 to a Temporal workflow execution. |
| **Plan** | The ordered set of Steps an agent proposes for a Run, plus a summary, risk assessment, and touched-files estimate. Versioned; a re-plan creates Plan v2. |
| **Step** | A single unit of the Plan (e.g., "add retry policy to NotificationService"). Has status, logs, tool calls, and produced artifacts. |
| **Agent** | A configured executor: a role (Planner, Coder, Reviewer, Researcher), a model binding, a toolset, a prompt/policy, and guardrails. Agents are definitions; an **Agent Session** is a running instance bound to a Run. |
| **Agent Session** | A live agent instance executing within a Run, holding a context window, a scratchpad/memory, and a tool-call history. |
| **Tool** | A capability the agent can invoke: `fs.read`, `shell.exec`, `code.search`, `test.run`, `git.branch`, `vcs.open_pr`, plus connector tools (`slack.post`, `jira.comment`) and MCP-exposed tools. |
| **Toolset** | A named, permissioned bundle of Tools assigned to an Agent for a Run. |
| **Workspace (sandbox)** | The isolated, ephemeral compute environment (microVM/container) where a Run's code checkout lives and where `shell.exec` / `test.run` execute. Not to be confused with **Tenant Workspace**. |
| **Tenant Workspace** | An organizational container: users, projects, integrations, RBAC scope, billing. (EDAP Workdesk calls its org container "Workspace" too; when ambiguous we write "Tenant Workspace".) |
| **Project** | Binds a repository (via Git provider) + a tracker source + default Agent config + policies. A Run belongs to exactly one Project. |
| **Connector** | An installed integration instance (e.g., "Acme Jira Cloud") implementing one or more provider contracts (Tracker, VCS, ChatOps, KV, MCP). |
| **Approval** | A pending human decision gating a Run or Step. Has a type (plan / risky-action / budget-overrun / policy-exception), a payload of evidence, an SLA, and an outcome. |
| **Artifact** | A durable output of a Run: diff/patch, test report, build log, coverage file, screenshot, generated doc, PR URL. Stored in object storage, indexed in Postgres. |
| **Budget** | Per-Run (and per-Project, per-Tenant) ceilings on tokens, USD, wall-clock time, tool-call count, and sandbox minutes. Exceeding a soft limit raises an Approval; a hard limit aborts the Run. |
| **Policy** | A declarative rule set controlling what agents may do without approval (allowed paths, allowed shell commands, network egress, max files changed, protected branches). |
| **Memory** | Persisted knowledge reused across Runs: repo facts (`AGENTS.md`-style), past-Run outcomes, embeddings of code/docs (`pgvector`), and per-Project learned conventions. |

## Lifecycle states

| Object | States |
|--------|--------|
| **WorkItem** | `received` → `triaging` → `ready` / `needs_info` / `rejected` → `in_progress` → `delivered` / `failed` → `closed` |
| **Run** | `queued` → `planning` → `awaiting_plan_approval` → `executing` → `verifying` → `reviewing` → `awaiting_delivery_approval` → `delivering` → `succeeded` / `failed` / `cancelled` / `timed_out` |
| **Step** | `pending` → `running` → `succeeded` / `failed` / `skipped` |
| **Approval** | `open` → `approved` / `rejected` / `expired` / `auto_resolved` |
| **Agent Session** | `starting` → `active` → `paused` (HITL) → `active` → `finished` / `errored` |

## Technical terms

| Term | Definition |
|------|------------|
| **Control plane** | The always-on services: API, orchestrator, event bus, dashboard, DB. Never runs untrusted code. |
| **Execution plane** | The sandbox pool + agent workers. Runs untrusted, agent-directed code. Network-isolated from the control plane except via a broker. |
| **Model gateway** | The single egress point for all LLM calls. Handles provider routing, retries, failover, cost metering, redaction, caching. |
| **Durable workflow** | A Temporal workflow whose state survives process crashes and deploys; replays deterministically from event history. |
| **Activity** (Temporal) | A single side-effecting operation invoked by a workflow (call model, run tool, write DB). Retried independently. |
| **Signal** (Temporal) | An external asynchronous input to a running workflow (e.g., "approval granted", "cancel"). |
| **HITL** | Human-in-the-loop: a designed pause point where the workflow serializes state and waits for a human Signal. |
| **MCP** | Model Context Protocol — open standard (spec `2026-07-28`) for exposing tools/resources/prompts to agents over stdio or streamable HTTP with OAuth 2.1. |
| **AG-UI** | Agent–User Interaction protocol — typed event stream (`TOOL_CALL_START`, `TEXT_MESSAGE_CONTENT`, …) from agent backend to UI over SSE. Used as the shape for our live-activity stream. |
| **OTel GenAI semconv** | OpenTelemetry semantic conventions for generative-AI spans (`gen_ai.*` attributes). Our tracing baseline. |
| **Golden task** | A frozen, fully-specified WorkItem + repo state + expected outcome, used to regression-test agent quality (SWE-bench-style, but on our own fixtures). |
| **Repo map** | A compressed structural index of a repository (files, symbols, signatures) fed to the agent to orient it cheaply before it reads full files. |

## Actors / roles (see [14-security.md](./14-security.md) for the full RBAC matrix)

| Role | Summary |
|------|---------|
| **Owner** | Full control of a Tenant Workspace, including billing and integration secrets. |
| **Admin** | Manage projects, agents, policies, members. No billing. |
| **Maintainer** | Approve plans/deliveries, start/cancel Runs, merge externally. |
| **Operator** | Start Runs, watch dashboards, comment. Cannot change policies. |
| **Viewer** | Read-only dashboard + audit access. |
| **Service account** | Non-human principal for CI / webhook callers / the platform's own Git bot. |
