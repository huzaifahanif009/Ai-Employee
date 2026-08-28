# 01 — Product Vision & Requirements Framing

## 1. The problem

Engineering teams lose enormous time to well-specified but repetitive delivery work: small features, bug fixes, dependency bumps, test backfills, refactors, doc updates, migration chores. Each one still costs a full human context-switch — read the ticket, find the code, branch, implement, run tests, fix, push, open a PR.

LLMs can now do most of this loop, but the tools available fall into two unsatisfying buckets:

1. **Chat assistants / IDE copilots** (Copilot, Cursor, Claude Code, chat UIs). They help a human who is present and driving. They do not own a queue of tickets, run unattended for an hour, survive a restart, enforce a budget, or give a manager a dashboard of what 20 agents did overnight.
2. **Closed autonomous agents** (Devin and similar). Opaque, single-vendor for the model, single-vendor for the Git host, hard to self-host, weak on org-level controls (RBAC, audit, policy, cost governance), and you cannot bring your own provider or your own tracker.

**There is no open, production-grade, provider-agnostic execution platform** that:

- treats **task trackers, AI providers, and Git hosts as swappable integrations**,
- runs **durable, observable, sandboxed** agent work at team scale,
- puts **humans on the approval and merge gates**, and
- ships with a **real operations dashboard**, not a chat transcript.

Praxis is that platform.

## 2. Vision statement

> **Praxis turns a backlog into merged code.** A team connects its tracker, its Git host, and one or more AI providers. Praxis agents pick up ready tickets, plan the work against the real repository, execute it in a sandbox with tests, and deliver a reviewable PR — while operators watch every step live and approve anything risky. The team keeps the merge button.

## 3. Target users

| Persona | Context | What they get |
|---------|---------|---------------|
| **Platform / DevEx engineer** (primary buyer & operator) | Owns internal tooling for a 10–200 person eng org | Self-hosts Praxis; wires trackers/repos/providers; sets policy and budgets; monitors the fleet |
| **Team lead / EM** | Owns a backlog and a team's throughput | Routes suitable tickets to Praxis; reviews plans; reads throughput/cost/success analytics |
| **Individual engineer** | Reviews and merges Praxis PRs; hands off chores | Fewer interrupt-driven small tasks; a reliable "assign to agent" path; full visibility into what the agent did |
| **Engineering manager / director** | Cares about cost, ROI, risk | Historical analytics: tasks completed, success rate, spend, human hours saved, where agents fail |
| **Security / compliance** | Must approve any autonomous system touching code | Audit log, RBAC, sandbox model, secrets handling, egress controls, data-retention policy |

Secondary: agencies running client work, OSS maintainers triaging issues, data teams automating pipeline chores.

## 4. What success looks like (outcome metrics)

| Metric | Target by end of Beta | Target by GA |
|--------|----------------------|--------------|
| Autonomous PR acceptance rate (merged with ≤ minor edits) | ≥ 45% on "green" ticket classes | ≥ 65% |
| Median Run wall-clock for a small feature/bugfix | ≤ 25 min | ≤ 15 min |
| Operator interventions per successful Run | ≤ 2 | ≤ 1 |
| Cost per successful Run (model + sandbox) | ≤ $3 | ≤ $1.50 |
| Platform uptime (control plane) | 99.5% | 99.9% |
| Time from `docker compose up` to first successful Run (self-host) | ≤ 30 min | ≤ 15 min |
| Mean time to detect a stuck/looping Run | ≤ 2 min (auto) | ≤ 30 s (auto) |

## 5. Study: VIKTOR (for inspiration, not imitation)

**What VIKTOR is.** A low-code platform (viktor.ai) that lets *engineers* (civil, structural, geotechnical, mechanical) turn Python scripts and domain calculations into interactive web apps, without front-end work. ~35k engineers, ~30k apps built; used by Arup, WSP, AECOM, Arcadis, Mott MacDonald and similar firms.

**Architecture ideas worth borrowing:**

1. **The "worker" model.** VIKTOR runs a lightweight **worker** executable next to the customer's local/organization software. The worker holds an **outbound** TLS connection to the VIKTOR cloud (no inbound ports opened), waits for a *task* (inputs), runs the integrated software, and returns results. → Praxis adopts the same shape for its **execution plane**: sandbox runners and self-hosted runners dial *out* to the control plane; no inbound exposure of the customer's network or the sandbox host.
2. **Personal vs Organization workers.** VIKTOR distinguishes workers bound to one user's machine from workers on shared org infra. → Praxis mirrors this with **runner classes**: `cloud-pool` (platform-managed microVMs), `self-hosted` (customer VM/K8s), `local` (developer laptop for debugging a Run).
3. **Third-party compute for scripts** (`PythonAnalysis`, `GenericAnalysis`). VIKTOR sends code to be evaluated on *someone else's* infra and blocks on the result. → Praxis's `shell.exec` / `test.run` tools are the same primitive: a typed job dispatched to a runner, streamed back.
4. **Curated integration catalog.** VIKTOR advertises 100+ named engineering-tool integrations as a first-class selling point. → Praxis makes its **connector catalog** (trackers, VCS, ChatOps, CI, cloud) a first-class, versioned, documented surface.
5. **"Trusted, verified, transparent."** VIKTOR's marketing leads on trust for automated engineering work. → Praxis leads on **auditability and human gates**.

**What we deliberately do NOT copy:**

- VIKTOR is a *low-code app builder* for domain engineers. Praxis is a *headless execution platform* for software delivery. No drag-and-drop app editor, no parametric-design UI, no CAD/BIM integrations.
- VIKTOR's value is UI generation from Python. Praxis's value is autonomous multi-step execution with provider abstraction. Different core loop entirely.
- We will not build a proprietary SDK lock-in. Praxis's agent tools and connectors are open contracts; MCP is a first-class extension path.

## 6. Differentiation vs the field

| Capability | IDE copilots | Closed autonomous agents | CI bots (Renovate etc.) | **Praxis** |
|---|---|---|---|---|
| Owns a ticket queue unattended | ✗ | ~ | narrow | ✓ |
| Multi-provider AI (OpenAI/Anthropic/Gemini/…) | ~ | ✗ | n/a | ✓ (contract + gateway) |
| Multi Git host (GitHub/GitLab/Bitbucket/generic) | ~ | ✗ | ~ | ✓ (contract) |
| Pluggable trackers (Jira/Linear/GH/…) | ✗ | ~ | ✗ | ✓ (contract) |
| Durable, resumable long runs | ✗ | ~ | ✓ | ✓ (Temporal) |
| Human approval + policy engine | ✗ | ~ | ~ | ✓ |
| Real ops dashboard + analytics | ✗ | partial | partial | ✓ |
| Self-hostable, air-gap capable | ~ | ✗ | ~ | ✓ |
| Sandbox isolation for agent code | IDE-local | ✓ | n/a | ✓ (microVM) |
| Full audit + cost governance | ✗ | ✗ | ~ | ✓ |
| Extensible via MCP | ~ | ~ | ✗ | ✓ |

## 7. Non-goals (v1–GA)

1. **Not an IDE — but IDE-integratable.** Praxis does not build its own in-browser code editor or pair-programming cursor; its dashboard shows a read-only diff/file viewer only. It *is* designed to be driven from and surfaced inside existing IDEs — VS Code, JetBrains, Cursor, Claude Code — through the Praxis SDK and the **MCP server surface** ([09](./09-integration-tool-architecture.md) §5, [phase-6-future.md](./phases/phase-6-future.md) F-9): an engineer can start a Run, watch its live activity, review the diff, and approve gates without leaving the editor. Building the editor is out of scope; being a first-class citizen in one is not.
2. **Not auto-merge.** The platform never merges to a protected branch by default. Merge stays with a human. (An opt-in "auto-merge on green after N approvals" is a Future item, off by default, per-Project.)
3. **Not a model host.** We do not train or serve models. We route to providers (hosted or self-hosted endpoints the customer supplies).
4. **Not a general RPA / browser-automation product.** Web research and API tool-calls yes; brittle screen-scraping of arbitrary SaaS UIs, no.
5. **Not a chat product.** There is a conversational surface for steering a Run, but the product is judged on delivered artifacts.
6. **Not a task tracker.** Praxis consumes trackers; it does not replace EDAP Workdesk / Jira / Linear. It maintains only its own Run/execution records.
7. **No production deploys** in v1. The delivery boundary is "PR opened". Deploy/release automation is a Future integration behind extra approvals.

## 8. Guiding constraints

- **TypeScript and Python only** for first-party services (per stakeholder direction). Go permitted only if a specific component (e.g., a high-throughput SSE fan-out gateway) proves it in a spike; must be justified in [04](./04-technology-research.md).
- **Everything Dockerized**, one `docker compose` brings up the whole platform locally, including a stub tracker and a local Git server for offline demos.
- **Kubernetes-ready** from day one: 12-factor config, stateless control-plane services, externalized state, health/readiness probes, horizontal-scale-safe.
- **Secure by default**: least privilege, no plaintext secrets at rest, sandbox has no ambient cloud credentials, egress allowlists, full audit.
- **Modular**: provider adapters, connectors, and tools are independently versioned packages with contract tests; the core does not import a concrete provider.
