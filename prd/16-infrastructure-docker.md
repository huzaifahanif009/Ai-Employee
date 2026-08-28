# 16 — Infrastructure & Docker

## 1. Principles

- **One artifact set, two runtimes.** The same container images run under Docker Compose (local/eval) and Kubernetes (prod). Only config differs.
- **12-factor.** Config from env + mounted secret files; validated on boot; fail fast on missing required values.
- **Stateless control plane.** All state is external (Postgres, Redis, object storage, Temporal, secrets manager). Control-plane pods are disposable and horizontally scalable.
- **Multi-arch.** amd64 + arm64 images (dev on Apple Silicon; prod on either). The **sandbox host** is the exception — Firecracker needs KVM (nested virt or bare metal).
- **Air-gap capable.** With self-hosted model endpoints + self-hosted Git + no external connectors, no traffic leaves the customer network.

## 2. Container images

| Image | Base | Contents |
|-------|------|----------|
| `praxis/core` | `node:22-slim` (distroless final stage) | NestJS: API Gateway + BFF + Core Services + Model Router + VCS + Tracker + Tool Broker + Realtime Gateway + Webhook Ingress (modules; splittable via env `SERVICE_ROLE`) |
| `praxis/orchestrator` | `node:22-slim` | Temporal worker: `RunWorkflow` + activities |
| `praxis/agent` | `python:3.12-slim` | LangGraph runtime, tool executors, repo-map (tree-sitter), embeddings client, gRPC server |
| `praxis/sandbox-broker` | `node:22-slim` | Pool manager, lease/GC, snapshot orchestration, egress-policy push |
| `praxis/sandbox-runner` | minimal Linux + `firecracker` / `runsc` | Host-side agent that boots microVMs/gVisor containers, runs the in-VM runner protocol |
| `praxis/sandbox-rootfs` | custom (built in CI) | Guest rootfs: git, ripgrep, node/python/dotnet/java/go toolchains, common build tools, the in-VM runner binary. Pinned by digest, scanned, cosign-signed |
| `praxis/dashboard` | `nginx:alpine` | Built Angular (or Next.js) static assets + runtime config shim |
| `praxis/migrate` | `node:22-slim` | TypeORM migrations + seed (run as a Job/init container) |
| `praxis/stub-tracker` *(dev only)* | `node:22-slim` | Fake tracker with webhook emitter + sample tickets |

Build: multi-stage, non-root user, `HEALTHCHECK`, SBOM (CycloneDX) emitted, image scanned (Trivy) as a required gate, signed (cosign), pushed by digest. `.dockerignore` excludes `node_modules`, tests, docs.

## 3. Local: `docker compose up`

### Services in `docker-compose.yml`
`core`, `orchestrator`, `agent` (×2), `sandbox-broker`, `sandbox-runner`, `dashboard`,
`postgres` (app), `postgres-temporal`, `redis`, `temporal` + `temporal-ui`, `minio` + `minio-setup`,
`litellm`, `infisical`, `otel-collector`, `prometheus`, `grafana`, `loki`, `langfuse` + its `clickhouse`,
`stub-tracker`, `gitea` (local Git server for the offline demo).

Profiles:
- default → full platform
- `--profile minimal` → drops Langfuse/Grafana/Loki/Prometheus (lighter eval)
- `--profile demo` → adds `stub-tracker` + `gitea` + runs the seed + kicks a sample Run

### Sandbox backend auto-detect
`sandbox-runner` entrypoint probes `/dev/kvm`:
- present → **Firecracker** backend
- absent, `runsc` available → **gVisor** backend
- neither → **docker** backend with a loud `WARNING: sandbox isolation is NOT a security boundary in this mode — local/demo only`.

### One `.env`
Single `.env` (from `.env.example`) covers: ports, DB creds, JWT secret, `LITELLM_MASTER_KEY`, provider keys (optional for demo — stub model available), `INFISICAL_*`, object-storage creds, `PRAXIS_PUBLIC_URL`. A typed config module prints a clear list of missing required keys and exits non-zero.

### Acceptance (US-6.1)
`git clone && cp .env.example .env && docker compose --profile demo up` → within ~10 min: dashboard on `:8080`, a demo Tenant/Project, and a sample WorkItem that runs to a PR on the local Gitea. Target: evaluator productive in < 30 min.

## 4. Production: Kubernetes

### Namespaces & workloads
| Namespace | Workloads |
|-----------|-----------|
| `praxis-control` | Deployments (HPA): `core` (optionally split by `SERVICE_ROLE` into `api`, `bff`, `realtime`, `webhook`, `model-router`, `vcs`, `tracker`, `tool-broker`), `orchestrator` (Temporal worker, KEDA on task-queue depth), `dashboard`. Jobs: `migrate`. CronJobs: partition maintenance, mat-view refresh watchdog, audit-chain verify, canary Run, retention/archival. |
| `praxis-exec` | `agent` (Deployment, KEDA on queue depth), `sandbox-broker` (Deployment), `sandbox-runner` (DaemonSet on the sandbox node group). |
| `praxis-data` (or managed) | Postgres (operator: CloudNativePG/Zalando) ×2, Redis, NATS JetStream, MinIO (or cloud S3), Infisical. |
| `praxis-obs` (or external) | OTel Collector, Prometheus/Mimir, Grafana, Loki, Tempo, Langfuse. |
| `temporal` | Temporal server (Helm) + its Postgres + optional Elasticsearch. |

### Node groups
- **general** — control plane, data, obs (standard nodes, autoscaled).
- **sandbox-fc** — bare-metal or `.metal` instances with nested virt; taint `praxis.dev/sandbox=firecracker:NoSchedule`; `sandbox-runner` DaemonSet + `agent` pods tolerate it. Cluster-autoscaler scales this group on pending sandbox demand.
- **sandbox-gvisor** (alt) — nodes with the `runsc` RuntimeClass for environments without nested virt.

### Networking / NetworkPolicies
- `praxis-exec` egress: allow → `model-router` Service, `sandbox-broker` Service, DNS; **deny** all other in-cluster; **deny** `169.254.169.254`; internet egress only via the per-Run egress proxy with the Project allowlist.
- `praxis-control` → data/obs/temporal allowed; `praxis-control` does **not** need to reach `praxis-exec` (exec dials out to the broker).
- Ingress: one gateway (NGINX/Traefik/cloud LB) → `dashboard` + `/api` (`core`) + `/api/v1/streams` (`realtime`, with proxy buffering off for SSE) + `/api/v1/control` (`realtime` WS). TLS via cert-manager.

### Resilience
- HPA on CPU + custom metrics (`praxis_queue_depth`, in-flight requests).
- PodDisruptionBudgets: `minAvailable: 1` for every control-plane Deployment.
- `orchestrator` and `agent` handle SIGTERM gracefully: stop accepting new work, finish/су checkpoint in-flight, let Temporal/LangGraph resume elsewhere. In-flight Runs survive a rolling deploy (NFR-PERF-6).
- Anti-affinity spreads replicas across nodes/zones.
- Resource requests/limits on every container; sandbox pods get strict `limits` + cgroup enforcement in the runner.

### Config & secrets
- `ConfigMap` for non-secret 12-factor config; secrets via the Infisical/Vault **CSI driver** or the operator injecting into a `Secret` → mounted files (not env where avoidable).
- No cloud credentials in CI: **OIDC** federation to the registry/cloud.
- Image references pinned by digest; deploys via Helm chart (`charts/praxis`) or Kustomize overlays per environment (`dev`, `staging`, `prod`).

## 5. Scaling model

| Component | Scale signal | Notes |
|-----------|--------------|-------|
| `api` / `bff` | RPS, CPU | stateless, linear |
| `realtime` | connection count, bus lag | SSE stateless; WS sticky (or shared subscription registry) |
| `orchestrator` | Temporal task-queue backlog (KEDA) | more workers = more concurrent Runs |
| `agent` | agent-job queue depth (KEDA) | GPU not required (inference is remote) |
| `sandbox` pool | pending lease requests | warm-pool target = f(recent start rate); cluster-autoscaler adds nodes |
| Postgres | vertical + read replicas for analytics/BFF | partition maintenance automated |
| NATS/Redis | throughput | NATS clustered at scale |

Per-Tenant concurrency caps + budgets provide multi-tenant fairness (noisy-neighbor control).

## 6. CI/CD

**CI (GitHub Actions; GitLab CI mirror kept in sync):**
1. lint + typecheck (TS + Python) → unit tests → contract tests (provider/connector/tool suites) → build images → Trivy scan → SBOM → cosign sign.
2. spin an ephemeral Compose stack → run **integration tests** + a **fast golden-task subset** ([17](./17-testing-strategy.md)) → security scans (CodeQL/Semgrep, gitleaks) → migration up/down/up on scratch DB.
3. on tag: push signed images by digest, publish Helm chart, generate SDKs from OpenAPI, publish changelog.

**CD:**
- `dev` auto-deploys on merge to `main` (Argo CD / Flux).
- `staging` on tag; runs the **full** golden-task suite + a load test + the canary Run for 24h.
- `prod` is a promotion (manual approval) of the exact staging digest. Rolling update; migrations as a pre-deploy Job (expand/contract, so old pods still work during rollout). Documented rollback: redeploy previous digest + `migrate down` only if the release included a contract step (rare).

## 7. Environments

| Env | Purpose | Data | Providers |
|-----|---------|------|-----------|
| **local** | dev + evaluation | throwaway; seed + demo | stub model or dev keys |
| **CI ephemeral** | automated tests | per-run throwaway | recorded cassettes + stub model; opt-in live smoke |
| **staging** | pre-prod, load, full evals, canary | prod-like, synthetic tenants | low-budget real keys |
| **prod** | customers | PITR-backed, retention-governed | customer keys |

## 8. Backup / DR (infra view; DB detail in [10](./10-database-architecture.md) §7)

- Postgres (app + Temporal): WAL archiving + nightly base backup; PITR RPO ≤ 5 min / RTO ≤ 30 min; monthly restore drill.
- Object storage: versioned + cross-region replication (prod).
- Redis/NATS: not backed up (rebuildable); delivery idempotency guards against double side effects on loss.
- IaC (Terraform for cloud infra, Helm/Kustomize for workloads) in git = the environment is reproducible from code.
- "Rebuild from Postgres + S3" runbook: re-derive mat views, reconcile Temporal, resume Runs.

## 9. Cost & footprint (reference figures)

| Deployment | Rough shape |
|------------|-------------|
| Local (laptop) | ~6–10 GB RAM with `--profile minimal`; ~14–18 GB full |
| Small prod (≤ 20 concurrent Runs) | 3 general nodes + 1–2 sandbox nodes; managed PG small; ~ single-digit $k/mo infra + model spend |
| Reference prod (200 concurrent Runs) | HPA'd control plane, 6–12 sandbox nodes, PG with a read replica, NATS cluster; infra a fraction of model spend at that volume |

Model + sandbox cost per Run is the dominant variable cost; the [Analytics](./12-dashboard-ui-spec.md) "wasted spend" panel is the lever.

## 10. Operational runbooks (shipped in `/docs/runbooks`)

Bring-up, upgrade & rollback, add a provider/connector, rotate a leaked credential, sandbox pool exhausted, provider outage (Runs auto-paused — how to resume), Temporal task-queue backlog, Postgres failover, restore-from-backup drill, tenant hard-delete, "pause all Runs" kill-switch, canary Run failing.
