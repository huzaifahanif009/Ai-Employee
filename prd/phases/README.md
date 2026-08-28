# Phases

Per-phase breakdowns. Each phase file lists **tasks** with: id, summary, dependencies, acceptance criteria (AC), testing, and Definition of Done (DoD). The global DoD is in [../17-testing-strategy.md](../17-testing-strategy.md) §12 and applies to every task on top of what's listed.

| Phase | File | Theme |
|-------|------|-------|
| 0 | [phase-0-research.md](./phase-0-research.md) | Research & de-risking spikes |
| 1 | [phase-1-architecture.md](./phase-1-architecture.md) | Contracts, skeleton, CI, local stack |
| 2 | [phase-2-foundation.md](./phase-2-foundation.md) | Core platform, events, sandbox, dashboard shell |
| 3 | [phase-3-mvp.md](./phase-3-mvp.md) | End-to-end autonomy on one stack |
| 4 | [phase-4-beta.md](./phase-4-beta.md) | Breadth: providers, Git hosts, connectors, analytics, security |
| 5 | [phase-5-production.md](./phase-5-production.md) | Scale, SLOs, K8s, DR, pen test, GA |
| 6 | [phase-6-future.md](./phase-6-future.md) | Post-GA roadmap |

Task id scheme: `P<phase>-<stream>-<n>` where stream ∈ {CORE, AGENT, ORCH, PROV, SBX, FE, SEC, INFRA, DOC}.
