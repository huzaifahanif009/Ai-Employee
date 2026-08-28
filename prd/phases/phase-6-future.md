# Phase 6 — Future (post-GA)

Not scheduled. Each item has a trigger (when it becomes worth doing) and a rough shape. Nothing here may leak into Phases 0–5.

---

## Autonomy & delivery

### F-1 — Opt-in auto-merge on green
- **Trigger:** a Project shows ≥ 4 weeks of ≥ 80% autonomous acceptance on a ticket class with zero incidents.
- **Shape:** per-Project, per-label toggle; "auto-merge after N human approvals + all required checks green + no review-block"; still never force-merges; full audit; a "revert Run" one-click if it goes wrong. Default **off**, hard-gated by Owner.

### F-2 — Iterate-on-PR-review loop
- **Trigger:** design partners ask for it (common).
- **Shape:** PR review comments → follow-up commits addressing them, bounded, with its own budget + approval gate; `git.pr.comment` webhook drives a lightweight resume of the Run.

### F-3 — Deploy / release automation (behind heavy gates)
- **Trigger:** customers with mature CD ask, and a security review signs off.
- **Shape:** a `Deployer` connector contract (Argo/Flux/Spinnaker/GitHub Environments); a distinct `forbidden`→`approve`-with-2-person rule; canary + auto-rollback hooks; separate audit stream. Extends the delivery boundary past "PR opened".

### F-4 — Cross-repo / multi-PR changes
- **Trigger:** monorepo-adjacent orgs with shared libraries.
- **Shape:** a parent WorkItem fans into sibling Runs (one per repo/Connector), each independently reviewed/merged; a coordination view shows the set; dependency ordering between PRs.

## Agent capability

### F-5 — Backlog-wide auto-triage
- **Trigger:** triage precision/recall on golden tasks clears a bar (e.g. ≥ 0.9).
- **Shape:** point Praxis at an entire board; it triages everything, proposes a routed queue of "agent-suitable" items for human confirmation, learns from accept/reject.

### F-6 — Learned routing & config selection
- **Trigger:** enough Run history per Project.
- **Shape:** given a WorkItem, predict best Agent config + model bindings + budget from historical outcomes; bandit-style exploration within budget caps.

### F-7 — Repo-wide refactors / migrations
- **Trigger:** demand for framework upgrades, API migrations, codemods at scale.
- **Shape:** a long-horizon workflow that shards a large change into many small verified PRs with a tracking dashboard; heavier checkpointing; explicit "campaign" object.

### F-8 — Richer memory & code intelligence
- **Trigger:** context costs or recall quality plateau.
- **Shape:** SCIP-based cross-repo code intelligence; a dedicated code-intelligence service exposed as MCP tools; `MemGPT`-style hierarchical memory; per-org convention learning with human curation UI.

### F-9 — Praxis as an MCP server (broaden)
- **Trigger:** IDE/agent ecosystem demand.
- **Shape:** expand the P2 read/act surface; let external agents (Claude Code, Cursor, Codex) drive Praxis Runs and read live status; scoped OAuth, rate-limited, fully audited.

### F-9a — First-party IDE extensions (VS Code + JetBrains)
- **Trigger:** engineers repeatedly ask to run/review Praxis work without leaving the editor.
- **Shape:** thin extensions over the Praxis SDK + F-9 MCP server: "Send this issue to Praxis" from a linked tracker, a Runs panel with live status, inline diff review of a Run's changes, approve/reject gates from a notification, and "open the Run's branch" locally. No agent logic in the extension — it is a client. Read-only into the sandbox is still gated by F-14.

## Platform & scale

### F-10 — Multi-tenant SaaS (regional cells)
- **Trigger:** business decision to offer hosted.
- **Shape:** regional cells, per-cell control plane, bare-metal sandbox pools, per-tenant network namespaces + egress proxies, schema-per-large-tenant option, usage metering + billing, status page.

### F-11 — Self-hosted runner class ("bring your own compute")
- **Trigger:** customers who want sandboxes on their own hardware but the control plane hosted.
- **Shape:** VIKTOR-style outbound-only runner: a signed runner binary the customer runs on their infra, dials out to the control plane, executes Runs locally; no inbound ports; per-runner policy + attestation.

### F-12 — Kafka/Redpanda event tier + multi-DC replay
- **Trigger:** a customer needs cross-DC event replay at high volume.
- **Shape:** third `EventBus` impl; `run_event` archive as the replay source; multi-region read models.

### F-13 — Go SSE fan-out gateway
- **Trigger:** [../04-technology-research.md](../04-technology-research.md) §8 revisit — Node instance connection limits hit before cost-effective.
- **Shape:** a dedicated Go service subscribing to the bus and fanning out; same wire protocol; the only non-TS/Python first-party service, justified by a load benchmark.

## Product surface

### F-14 — Read-only sandbox shell viewer
- **Trigger:** operators repeatedly need to see the live FS/process state to debug.
- **Shape:** RBAC-gated, read-only terminal into a running sandbox (command-restricted); heavily audited; never a write path.

### F-15 — Cost optimization advisor
- **Trigger:** "wasted spend" is a recurring line item.
- **Shape:** analyzes Run history and recommends config changes (cheaper model for Reviewer, tighter triage threshold, smaller repo-map budget) with projected savings; one-click shadow-run to validate.

### F-16 — MS Teams / Discord ChatOps, more trackers
- **Trigger:** demand.
- **Shape:** additional `ChatOpsProvider` + `TrackerProvider` impls (Azure DevOps Boards, Asana, ClickUp, Shortcut, email-in) via the existing contracts + contract-test suites.

### F-17 — White-label / theming
- **Trigger:** partners embedding Praxis.
- **Shape:** full theming, custom domains, per-tenant branding, embeddable Run-detail widget.

### F-18 — Marketplace for connectors/tools/prompt packs
- **Trigger:** a healthy third-party contract-test ecosystem.
- **Shape:** a catalog with versioning, signing, ratings, and the contract-test badge as the trust signal; install from the dashboard.

## Compliance

### F-19 — SOC 2 Type II certification
- **Trigger:** enterprise sales requirement.
- **Shape:** formal audit against the P5-SEC-3 control matrix; evidence automation from CI/CD + audit log.

### F-20 — Data-residency guarantees & customer-managed keys (CMK)
- **Trigger:** regulated customers.
- **Shape:** per-Tenant region pinning for all stores; CMK/BYOK for envelope encryption; attestable "no data left region" reports.
