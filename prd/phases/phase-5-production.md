# Phase 5 — Production / GA

**Goal:** operate at scale with SLOs, on Kubernetes, with DR, alerting, a passed external pen test, and complete docs. Milestone **M5**.

**Exit criteria (GA sign-off):** M5 demo passes; external pen test → 0 criticals/highs; all [../15-observability.md](../15-observability.md) §8 SLOs met in staging for 2 consecutive weeks; DR drill passed; docs + runbooks complete; upgrade/rollback rehearsed.

---

## Scale & performance

### P5-INFRA-1 — Kubernetes deploy (Helm chart)
- Deps: P4 (feature-complete).
- `charts/praxis` (or Kustomize overlays): control-plane Deployments (optionally split `core` by `SERVICE_ROLE`) with HPA; `praxis-exec` namespace with the sandbox node group (Firecracker on nested-virt/bare-metal, or gVisor RuntimeClass); NetworkPolicies ([../16-infrastructure-docker.md](../16-infrastructure-docker.md) §4); PDBs; anti-affinity; resource requests/limits; probes; secrets via CSI; Temporal via Helm with its own PG.
- **AC (US-6.2, NFR-MAINT-5):** the exact staging image digests deploy to a fresh cluster; all `/readyz` green; a synthetic Run reaches PR; NetworkPolicy blocks exec→control and exec→metadata (tested from inside a sandbox).
- **DoD:** [../16-infrastructure-docker.md](../16-infrastructure-docker.md) §4 realized; one-command `helm install` documented.

### P5-INFRA-2 — Autoscaling + load validation
- Deps: P5-INFRA-1.
- KEDA on Temporal task-queue + agent-job queue; cluster-autoscaler on the sandbox node group; sandbox warm-pool target = f(recent start rate); k6 + Run-load generator.
- **AC (NFR-PERF-2..7):** 200 concurrent Runs sustained 1h — no lost Runs, queue drains, API p95 < 300 ms, SSE p95 < 750 ms; 10k events/s bus + 5k SSE clients → lag < 2 s; sandbox 50 leases/min → cold-start p95 < 8 s, warm > 0; control-plane restart under load → 100% resume < 60 s.
- **Testing:** load reports committed; 24h soak with leak watch (memory, FDs, Redis keys, orphan sandboxes, partition growth).
- **DoD:** perf numbers in a signed report vs [../02-requirements.md](../02-requirements.md) NFR-PERF.

### P5-INFRA-3 — SSE/WS fan-out at scale
- Deps: P4-FE-*, P5-INFRA-2.
- NATS JetStream `EventBus` impl swapped in for scale tier; Realtime Gateway horizontal scale; per-connection backpressure + drop-and-reconnect; token/log/counters coalescing verified under load. If Node can't hold target connection counts, execute the pre-approved Go fan-out gateway spike ([../04-technology-research.md](../04-technology-research.md) §8 revisit trigger).
- **AC:** 5k concurrent SSE + 1k WS across 3 gateway instances; kill one instance → clients reconnect + backfill by `seq`, no gaps/dupes.
- **DoD:** [../11-event-architecture.md](../11-event-architecture.md) §6 validated; bus impl decision recorded.

## Reliability & DR

### P5-INFRA-4 — Backups, PITR, DR drill
- Deps: P5-INFRA-1.
- App PG + Temporal PG: WAL archiving + nightly base; object storage versioned + cross-region (prod); documented "rebuild from Postgres + S3" runbook; partition maintenance + archival CronJobs.
- **AC (NFR-REL-5, US-6.3):** a full restore drill hits RPO ≤ 5 min / RTO ≤ 30 min; after restore, in-flight Temporal workflows resume and Runs continue or fail cleanly.
- **DoD:** DR drill report; runbook validated by someone who didn't write it.

### P5-INFRA-5 — Zero-downtime upgrade + reversible migrations
- Deps: P5-INFRA-1.
- Rolling deploy; pre-deploy migration Job (expand/contract only — one-minor-version forward/back compat); documented rollback per release.
- **AC (US-6.3, NFR-MAINT-2):** upgrade staging under load with 3 in-flight Runs → API stays available, Runs resume, no migration break; rollback to the previous digest works.
- **DoD:** upgrade + rollback rehearsed and documented.

## Observability & SLOs

### P5-INFRA-6 — Alerting, SLOs, canary Run
- Deps: P2-INFRA-1, P5-INFRA-2.
- Alertmanager rules for every [../15-observability.md](../15-observability.md) §8 SLO; routing (page vs warn vs banner); runbook link per alert; scheduled canary Run every 30 min per environment; tail-sampling policy (keep 100% errors/slow/approval/failed).
- **AC (NFR-OBS-5):** an injected stuck Run pages within 5 min; an approval within 15 min of SLA re-notifies then pages on breach; provider-all-down pages and Runs auto-pause; canary failure pages.
- **DoD:** on-call runbook set complete; a game-day exercise run against the alerts.

### P5-INFRA-7 — Long-retention metrics + cost export
- Deps: P2-INFRA-2.
- Mimir/Thanos for 13-month downsampled metrics; monthly per-Tenant cost CSV export; optional per-provider invoice cross-check surfacing `costUsd` deltas.
- **AC (FR-PLAT-10, [../15-observability.md](../15-observability.md) §10):** cost export matches the ledger; historical dashboards span 12 months.
- **DoD:** finance-reconciliation doc.

## Security & compliance

### P5-SEC-1 — External penetration test + remediation
- Deps: P4-SEC-1/2, P5-INFRA-1.
- Engage a third party against a staging deployment (control plane, sandbox escape attempts, multi-tenant isolation, auth, secrets, egress, prompt-injection). Triaged remediation.
- **AC (NFR-SEC-8):** 0 criticals/highs at GA sign-off; mediums on a tracked plan with SLAs.
- **DoD:** pen-test report + remediation evidence; retest of any critical/high.

### P5-SEC-2 — Supply chain + incident readiness
- Deps: P1-INFRA-2.
- SBOM per release (CycloneDX), images signed (cosign) + verified at admission (policy controller); CodeQL/Semgrep + Trivy + gitleaks as hard gates; DAST (ZAP baseline) in staging; incident-response runbooks (credential compromise, sandbox-escape suspicion, provider key leak, tenant-data exposure); platform-wide + per-tenant "pause all Runs" kill-switch; forensic sandbox snapshot on suspicion.
- **AC (NFR-SEC-6):** admission rejects an unsigned image; kill-switch pauses all Runs in < 30 s and they resume cleanly after.
- **DoD:** [../14-security.md](../14-security.md) §12 complete; `security.txt` + disclosure policy published.

### P5-SEC-3 — SOC 2 controls mapping (GA+)
- Deps: P5-SEC-1.
- Map existing controls (audit, RBAC, change mgmt, access review, backup, incident response) to SOC 2 Type II; identify gaps; access-review cadence; change-management evidence from CI/CD.
- **AC (NFR-COMP-4):** a documented control matrix + gap plan; not a certification, a readiness baseline.
- **DoD:** compliance doc handed to the customer's security team as evidence.

## Product polish

### P5-FE-1 — Dashboard hardening + a11y + deep links
- Deps: P4-FE-*.
- Keyboard nav across all screens; WCAG 2.1 AA audit + fixes on core flows; deep links to any Run/Step/Approval; empty/error/loading states; 1k-Runs-in-history perf (virtualization, first paint < 1.5 s); connection-state UX polish everywhere.
- **AC (NFR-UX-1..4, FR-DASH-10):** a11y audit passes; deep links resolve; perf budget met with a seeded 1k-Run history.
- **DoD:** [../12-dashboard-ui-spec.md](../12-dashboard-ui-spec.md) §1 perf/a11y bars met; §16 real-time rules pass an automated check in CI.

### P5-CORE-1 — API v1 freeze + SDKs + CLI
- Deps: [../13-api-design.md](../13-api-design.md).
- Freeze `/api/v1`; OpenAPI 3.1 published; generate TS + Python SDKs (with SSE/WS helpers + pagination iterators); `praxis` CLI; contract (Pact-style) tests between dashboard/SDKs/API in CI; `GET /meta/capabilities`.
- **AC (FR-PLAT-11):** SDK quickstarts work against a fresh deploy; deprecation policy + changelog endpoint live.
- **DoD:** API reference + SDK docs published.

### P5-AGENT-1 — Golden `full` suite + quality baseline
- Deps: P4-AGENT-1.
- Grow to `full` (~120+ tasks, 5 stacks, bug/feature/refactor/test/docs mix); nightly + release runs; publish the quality time series (pass rate, cost, wall-clock, intervention proxy, injection-canary pass); regression gates enforced on every promoted config.
- **AC ([../17-testing-strategy.md](../17-testing-strategy.md) §4):** `full` runs green in staging; a promoted config that regresses `core` > 3 pts is blocked; task variance > 20% quarantined.
- **DoD:** quality dashboard is the source of truth for "is the agent good enough".

## Docs & launch

### P5-DOC-1 — Docs, runbooks, launch checklist
- Deps: all.
- Admin guide (install, connect providers/Git/trackers, policies, budgets, RBAC, retention, air-gap), operator guide (dashboard, approvals, tuning, troubleshooting), developer guide (API/SDK/CLI, connectors, MCP, contract tests), all runbooks ([../16-infrastructure-docker.md](../16-infrastructure-docker.md) §10), architecture overview, security whitepaper (sandbox model, data handling, threat model summary).
- **AC (US-6.1 final):** an external evaluator goes `docker compose` → first successful Run in ≤ 30 min following only the docs; an operator resolves a simulated incident using only a runbook.
- **DoD:** GA launch checklist signed off by each stream lead; [../18-implementation-roadmap.md](../18-implementation-roadmap.md) §7 GA gate met.
