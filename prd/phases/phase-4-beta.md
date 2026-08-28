# Phase 4 — Beta: Breadth & Hardening

**Goal:** remove the single-stack limits. Multiple AI providers with failover, multiple Git hosts, Jira + Linear intake, Slack approvals hardened, MCP client, analytics, RBAC depth + SSO, security hardening, more languages. Run a design partner's real backlog. Milestone **M4**.

**Exit criteria (advance to P5):** M4 demo passes; design-partner autonomous acceptance ≥ 55%; RBAC/SSO/audit complete; internal security review clean; golden `core` covers ≥ 4 language stacks; analytics dashboards live on real data.

---

## AI providers — breadth

### P4-PROV-1 — Gemini adapter + auto-routing + region pinning
- Deps: P1-PROV-1.
- Add Google Gemini (native adapter where LiteLLM gaps exist: safety settings, thinking); implement `routingClass`-based auto-routing (cheapest catalog entry meeting capability + region + budget constraints); enforce `data_region` allowlist per Tenant/Project.
- **AC (FR-AI-2..5,10):** a Run can use Anthropic for Planner + a code model for Coder + OpenAI for Reviewer; injected primary outage → seamless failover across providers with attempts recorded; a Tenant restricted to `self`/`eu` regions never routes elsewhere (tested).
- **Testing:** contract suites for 3 providers; failover integration; region-pin test.
- **DoD:** [../07-ai-provider-abstraction.md](../07-ai-provider-abstraction.md) §5–6 complete.

### P4-PROV-2 — Self-hosted / air-gap model path + caching
- Deps: P4-PROV-1.
- vLLM/Ollama/TGI registration flow; semantic cache (pgvector) + prompt-cache hints for stable prefixes; "air-gap mode" config (only `data_region: self`, no external connectors, no telemetry).
- **AC (FR-AI-3,9, NFR-COMP-1):** a Run completes using only a self-hosted endpoint; semantic cache hit recorded at `cost=0`; air-gap mode refuses to start if any external egress is configured.
- **DoD:** [../07-ai-provider-abstraction.md](../07-ai-provider-abstraction.md) §6,§9 complete; air-gap documented.

## Git hosts — breadth

### P4-PROV-3 — GitLab + Bitbucket + generic adapters
- Deps: P1-PROV-2.
- `VcsProvider` for GitLab (`@gitbeaker`, MR terminology, approvals API, pipelines-as-checks, protected branches) + Bitbucket Cloud (REST v2, app-password/repo-token, short-TTL where possible) + generic Git (CLI only; `capabilities().pullRequests=false` → push branch + patch Artifact + instructions).
- **AC (FR-GIT-2,6):** each passes the full `VcsProvider` contract suite; a Run delivers an MR on GitLab and a PR on Bitbucket without duplicates; generic mode produces a downloadable patch + a clear "no PR API" result.
- **Testing:** contract suites + live smoke against test orgs; webhook normalize per provider per event.
- **DoD:** [../08-git-provider-abstraction.md](../08-git-provider-abstraction.md) §4 table all green.

### P4-PROV-4 — Git webhooks → platform events
- Deps: P4-PROV-3.
- Ingest push/PR/comment/merge/check events across all hosts, normalized ([../08-git-provider-abstraction.md](../08-git-provider-abstraction.md) §8); `git.pr.merged` closes the WorkItem + marks the tracker done; `git.pr.closed` unmerged → WorkItem `rejected`.
- **AC (FR-GIT-4):** merging a Praxis PR flips the WorkItem to `closed` and transitions the Jira/Linear/GitHub/Workdesk item; check status shows on the Run PR tab.
- **DoD:** [../11-event-architecture.md](../11-event-architecture.md) §4.8 events flowing.

## Trackers — breadth

### P4-PROV-5 — Jira + Linear connectors
- Deps: P2-PROV-1.
- Jira (OAuth 2.0 3LO / API token, JQL poll + webhooks, transitions, remote link, AC parsing) + Linear (OAuth / API key, webhooks + poll, state changes, attachment link).
- **AC (FR-INT-5, US-1.2):** connect via OAuth; a filtered Jira issue → WorkItem < 10 s; `run.delivered` comments + transitions to "In Review"; a Linear issue round-trips the same.
- **Testing:** contract suite for `TrackerProvider`; dedupe on redelivery; poll/webhook parity.
- **DoD:** [../09-integration-tool-architecture.md](../09-integration-tool-architecture.md) §2 table (Jira/Linear rows) complete.

## MCP

### P4-INT-1 — MCP client
- Deps: P2-CORE-5.
- Mount external MCP servers (stdio + streamable HTTP with OAuth 2.1: PRM discovery RFC 9728, `iss` validation RFC 9207, DCR `application_type`); enumerate tools/resources/prompts; per-Project tool assignment + risk tier (default `approve`); calls flow through the Tool Broker; results `untrustedOutput`; usage/latency recorded; graceful degradation on server failure.
- **AC (FR-INT-3, US-4.1):** register a server, see its tools, assign one to a Project, use it in a Run — it appears in the tool-call log like a native tool; a down server marks the tool unavailable for the Run and logs it.
- **Testing:** against a reference MCP server (filesystem/docs); OAuth flow test; failure-injection.
- **DoD:** [../09-integration-tool-architecture.md](../09-integration-tool-architecture.md) §5 client path complete.

## Verification — breadth

### P4-CORE-1 — Integration + E2E verification
- Deps: P3-CORE-1.
- Project-supplied compose file spun inside the sandbox for dependent services; integration + Playwright/E2E steps; coverage delta computation; results in PR + Verification tab.
- **AC (FR-VERIFY-2,5):** a Run for a full-stack fixture brings up services, runs E2E scenarios, reports pass/fail + coverage delta; a failing E2E feeds the bounded fix loop.
- **DoD:** [../02-requirements.md](../02-requirements.md) FR-VERIFY-1 P1 items done.

### P4-AGENT-1 — Multi-language coverage
- Deps: P3-AGENT-3.
- Sandbox rootfs + tools + golden tasks for Python, .NET, Java, Go (≥ 1 runnable repo each; ≥ 8 `core` tasks each); language-specific test/build command detection.
- **AC:** `core` golden pass rate holds ≥ baseline across all 5 stacks; per-language dashboards in the eval report.
- **DoD:** [../17-testing-strategy.md](../17-testing-strategy.md) §4 stack coverage met.

### P4-AGENT-2 — Multi-agent within a step (Coder ↔ Reviewer sub-loop)
- Deps: P3-AGENT-3/4.
- Structured "write → self-review → revise" sub-loop before a Step is marked done, bounded by its own cap; handoff message `{decision, findings[], patch_ref}`.
- **AC (FR-EXEC-10):** enabling the sub-loop measurably raises golden `core` pass rate or lowers review-block rate without a >15% cost rise (shadow-run comparison recorded).
- **DoD:** [../06-agent-architecture.md](../06-agent-architecture.md) §3 sub-loop implemented; opt-in per Agent config.

## Platform — RBAC / SSO / analytics

### P4-CORE-2 — SSO (OIDC/SAML) + project-scoped roles
- Deps: P1-CORE-3.
- OIDC/SAML via the customer IdP or bundled Keycloak/Ory; JIT provisioning + role mapping; MFA (TOTP/WebAuthn); project-scoped role assignments (Maintainer on A, Operator on B).
- **AC (FR-PLAT-2, US-5.3):** SSO login works; a user's effective capabilities differ per Project; role change takes effect on next token refresh.
- **DoD:** [../14-security.md](../14-security.md) §2–3 fully implemented.

### P4-CORE-3 — Budgets & cost governance
- Deps: P2-INFRA-2.
- Tenant + Project monthly caps; soft % warning; on-breach behavior (block vs approve); burn-rate projection; standing approvals ("auto-approve dependency bumps in repo X for label Y") within Policy.
- **AC (US-3.3, FR-APPROVE-6,7):** at 80% a warning; at 100% new Runs blocked or gated per config; a standing approval auto-resolves matching low-risk approvals and is fully audited.
- **DoD:** [../12-dashboard-ui-spec.md](../12-dashboard-ui-spec.md) §14 budgets + §8 cost analytics wired.

### P4-FE-1 — Analytics screens
- Deps: P2-INFRA-2, P4-CORE-3.
- Throughput, success rate (by type/size), duration distribution, human-intervention rate, failure taxonomy, cost ($/day by model, $/successful Run, wasted spend), tokens, value estimate (hours/$ saved), provider reliability; time-window selector; drill-through to Run lists.
- **AC (US-3.4, FR-DASH-7):** all panels render from real data, refresh ≤ 1 min; every chart drills to the underlying Runs.
- **DoD:** [../12-dashboard-ui-spec.md](../12-dashboard-ui-spec.md) §8 realized.

### P4-FE-2 — Agents & Policies screen + shadow runs
- Deps: P3-AGENT-6.
- Versioned Agent config editor (model bindings + fallbacks, toolset toggles, prompt-pack edit + diff, context knobs, guard overrides within maxima); Policy rule editor with presets + platform-maxima ceilings; shadow-run UI (golden set or mirror last N real Runs) with a compare report + promote gate.
- **AC (US-3.5, FR-INT-7,8):** editing a config creates a version, diffable + rollback; a shadow run blocks promotion on a regression; policy edits can't exceed maxima; all audited.
- **DoD:** [../12-dashboard-ui-spec.md](../12-dashboard-ui-spec.md) §10 realized.

### P4-FE-3 — Integrations screen + Audit Log screen
- Deps: P4-PROV-3/5, P4-INT-1, P1-CORE-5.
- Connector catalog (status/health/config/projects/enable/reconnect), MCP server registration + tool assignment, ChatOps channel routing + user mapping, outbound webhooks registry + delivery log; Audit Log screen (filter by actor/action/target/date, before→after, export, chain-verify badge).
- **AC (FR-DASH-8, US-5.2):** connector health matrix is live; audit filters + export work; chain-verify badge reflects the daily job.
- **DoD:** [../12-dashboard-ui-spec.md](../12-dashboard-ui-spec.md) §11 + §13 realized.

## Event — outbound webhooks

### P4-CORE-4 — Outbound webhooks
- Deps: P1-CORE-6.
- Tenant-registered endpoints subscribed to a filtered event set; HMAC-signed, `t=` anti-replay, exponential-backoff retries, dead-letter after N, delivery log.
- **AC (FR-INT + [../11-event-architecture.md](../11-event-architecture.md) §8):** `run.completed` and `approval.requested` deliver to a test endpoint; a failing endpoint retries then dead-letters; deliveries visible + replayable.
- **DoD:** documented for customers wiring Praxis into their systems.

## Security hardening

### P4-SEC-1 — Red-team suite + prompt-injection defenses + SSRF/egress proxy
- Deps: P2-SEC-1, P2-CORE-5.
- Documented red-team suite ([../17-testing-strategy.md](../17-testing-strategy.md) §9) run per release; untrusted-content tagging on all external tool outputs; per-step toolset allowlist enforced pre-exec; `web.fetch`/connector calls via an egress proxy with private-IP block + host allowlist; injection canaries expanded.
- **AC (NFR-SEC-4,5, US-5.1):** every red-team scenario (egress, metadata, cross-tenant, exfil, persistence, escape, CPU abuse) is contained + alerted; injection canaries all pass in CI.
- **DoD:** [../14-security.md](../14-security.md) §5–6 verified; a red-team report attached to the release.

### P4-SEC-2 — Data retention + hard delete
- Deps: [../10-database-architecture.md](../10-database-architecture.md) §4.
- Per-Tenant retention config (logs, artifacts, model I/O, context snapshots, traces); partition archival to S3 (Parquet); hard-delete job across Postgres (incl. partitions), object storage, pgvector, Redis, Langfuse; signed completion record.
- **AC (FR-PLAT-10, US-5.4, NFR-COMP-2):** setting a retention window prunes old data on schedule; a delete request purges a Tenant within the SLA and writes an audit completion row.
- **DoD:** [../14-security.md](../14-security.md) §9 complete.

## Design partners

### P4-DOC-1 — Design-partner onboarding + results
- Deps: everything above.
- Onboard 2–3 teams: connect their tracker + Git + providers, narrow ticket classes, plan+delivery approval forced on, tight budgets; weekly review of acceptance, wasted spend, interventions, failure taxonomy; mint golden tasks from failures.
- **AC:** ≥ 55% autonomous acceptance on agreed classes; cost/successful Run trending to target; no security incidents.
- **DoD:** a "Beta results" report vs [../01-product-vision.md](../01-product-vision.md) targets; GA go/no-go.
