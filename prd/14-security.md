# 14 — Security

## 1. Security model at a glance

| Layer | Control |
|-------|---------|
| **Two planes** | Control plane never executes untrusted code. Execution plane (sandboxes + agent workers) executes agent-directed code, holds **no** ambient cloud/control-plane credentials, connects **outbound only**. |
| **Isolation** | Firecracker microVM per Run (hardware/KVM boundary); gVisor fallback; plain Docker only for local/trusted demos (documented as not a boundary). |
| **Least privilege** | Per-Run ephemeral, path-scoped Git tokens (TTL = Run budget + margin). Connector creds live in the control plane, never in the sandbox. Model calls are the sandbox's only "outbound to us" path, via the Model Router. |
| **Egress control** | Sandbox egress default-deny; per-Project allowlist (package registries + Git host + Model Router). Enforced by a per-Run network namespace + filtering proxy. No cloud metadata (169.254.169.254 blocked). |
| **Human gates** | Risky/outward-facing/destructive actions require Approval; merge is never automated. |
| **Audit** | Append-only, hash-chained audit log of every state change, approval, config edit, secret access, and tool call. |
| **Data governance** | Redaction of secrets/PII before model calls and before log/trace persistence; per-Tenant retention + hard delete; data-region pinning. |

## 2. Authentication

- **Users:** email+password (Argon2id) for self-host default; **OIDC/SAML SSO** (P1) via Keycloak/Ory or the customer's IdP. MFA supported (TOTP/WebAuthn).
- **Sessions:** short-lived access JWT (≤ 15 min) + rotating refresh token (httpOnly, secure cookie for the dashboard; token pair for API/CLI). Refresh reuse detection revokes the family.
- **Service accounts:** scoped tokens (CI, webhook callers, the platform Git bot, MCP). Scopes are explicit (`runs:start`, `approvals:decide`, `readonly`, …). Rotatable; last-used tracked; auto-disable on N days idle (configurable).
- **Internal services:** mTLS (SPIFFE-style workload identity) or signed short-lived service tokens between control-plane services; the execution plane authenticates to the broker with a per-worker key and can reach **only** the broker + Model Router ingress.
- **Webhooks in:** provider signature verification (no platform JWT).
- **MCP:** as a client, OAuth 2.1 to remote servers (PRM discovery RFC 9728, `iss` validation RFC 9207, DCR `application_type`); as a server (P2), OAuth 2.1 resource server with scoped tokens.

## 3. Authorization — RBAC

### Roles → capabilities matrix

| Capability | Owner | Admin | Maintainer | Operator | Viewer | Service (scoped) |
|---|---|---|---|---|---|---|
| View dashboards / runs / audit | ✓ | ✓ | ✓ | ✓ | ✓ | if `readonly` |
| Start / retry a Run | ✓ | ✓ | ✓ | ✓ | ✗ | if `runs:start` |
| Pause / resume / comment / cancel Run | ✓ | ✓ | ✓ | ✓ | ✗ | if `runs:control` |
| Approve plan / delivery / risky action | ✓ | ✓ | ✓ | ✗ | ✗ | if `approvals:decide` |
| Override review `block` / grant extra budget | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Create/edit Projects | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Edit Agent configs / prompt packs | ✓ | ✓ | ✓ (non-promote) | ✗ | ✗ | ✗ |
| Promote a config / policy version | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Edit Policy (within maxima) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Manage connectors / providers / secrets refs | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Manage members / roles | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Billing / retention / tenant delete | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Read raw secret values | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (nobody; write-only UI, values only in secrets manager) |

### Enforcement
- A NestJS **guard** checks `(role, capability, tenantScope, projectScope)` on every route; a decorator declares the required capability. Missing/covering check fails CI (a test enumerates routes vs declared capabilities).
- Event subscriptions (SSE/WS) run the same check per topic.
- Project-scoped roles (P1): a user can be Maintainer on Project A, Operator on Project B.
- Cross-tenant object → `404` (no existence disclosure). PostgreSQL RLS as a backstop.

## 4. Secrets management

- **Store:** `SecretsProvider` interface; default **Infisical** (self-host), adapter for **OpenBao/Vault**. Never in Postgres, env files (beyond local `.env`), or logs.
- **At rest:** KMS-backed envelope encryption (cloud KMS or Infisical/OpenBao transit).
- **Access:** services fetch by reference with a workload identity; every fetch is audited (`secret.accessed` with purpose, no value).
- **Rotation:** built-in for common providers; a `reconnect()` on connectors picks up new refs with no downtime. Compromise runbook: rotate → revoke ephemeral tokens → invalidate sessions → audit sweep.
- **Sandbox injection:** control plane fetches only what a Run needs (Git ephemeral token, maybe a test-env secret the Project marks "inject"), passes it over the authenticated broker channel; the runner mounts it as a `tmpfs` file / scoped env for the Run lifetime; wiped on teardown. The agent's **LLM context never contains raw secrets** (Model Router redaction includes all Tenant secret values + patterns).
- **What never enters the sandbox:** provider API keys (calls proxied via Model Router), connector OAuth tokens, other Projects'/Tenants' anything, cloud credentials.

## 5. Sandbox & execution-plane security

| Threat | Control |
|--------|---------|
| Container/VM escape | Firecracker microVM (separate kernel, minimal device model); seccomp + minimal rootfs; drop all caps; non-root; read-only base, writable overlay; no nested Docker unless explicitly enabled |
| Credential theft / exfil | No ambient creds; egress allowlist; Model Router is the only inbound-to-control path and it authenticates + budgets + redacts; DNS via a controlled resolver; block metadata endpoints |
| Lateral movement | Per-Run network namespace; NetworkPolicy: exec namespace → {broker ingress, model-router ingress} only; deny east-west |
| Resource abuse / crypto-mining | CPU/mem/disk/pids cgroup limits; wall-clock budget; egress bandwidth cap; anomaly alert on sustained CPU + network |
| Persistence between Runs | VM destroyed on Run end; overlay discarded; snapshots (for pause/resume) encrypted, retention-limited, never shared across Runs/tenants |
| Supply-chain in the target repo's build | Build/test run inside the sandbox with the same egress limits; no host mount; results treated as untrusted output |
| Poisoned base image | Base rootfs built in CI, scanned, signed (cosign), pinned by digest; rebuilt on a schedule + CVE trigger |

## 6. Prompt injection & agent misuse

Attack surface: ticket bodies, code/comments in the repo, web pages fetched, tool outputs, MCP resources — all attacker-influenceable.

Mitigations:
1. **Untrusted-content tagging:** every tool result that includes external/free-form text is wrapped in explicit delimiters and labeled untrusted; system prompts instruct the model to never treat wrapped content as instructions and never act on requests found inside it.
2. **Deterministic control flow:** an LLM never decides *which role/step runs next* or *whether an approval is needed* — the Orchestrator does. The blast radius of a hijacked turn is one bounded step's toolset.
3. **Per-step toolset allowlist + Policy:** the Tool Broker enforces path globs, shell-command allowlist, egress allowlist, max files, risk tiers **before** execution — independent of what the model "decided".
4. **No secrets in context:** redaction guarantees a hijacked model can't read a key that isn't there.
5. **Outward actions gated:** PR open, external posts, egress outside allowlist = `approve` tier → human sees the exact payload.
6. **Exfil channels closed:** egress allowlist + redaction of tool *inputs* to `web.*` (can't POST a secret it doesn't have and can't reach an arbitrary host).
7. **Injection canaries:** golden tasks include planted injection strings in fixtures; CI fails if the agent follows them ([17](./17-testing-strategy.md)).
8. **Rate/loop guards** ([06](./06-agent-architecture.md) §6) cap damage from a runaway.
9. **MCP tools default to `approve`** until an admin reviews and lowers the tier.

## 7. Application security

- Input validation everywhere (`class-validator` / pydantic); output encoding; no string-built SQL (ORM/parameterized only).
- CSRF: dashboard uses httpOnly cookie + `SameSite=strict` + CSRF token for state-changing routes; API tokens are not cookie-based.
- CSP, HSTS, `X-Content-Type-Options`, frame-ancestors none; strict CORS allowlist.
- File uploads (attachments) streamed through an authenticated endpoint, type/size checked, stored in object storage, never executed, served with `Content-Disposition: attachment`.
- SSRF: `web.fetch` and connector calls go through an egress proxy with an allowlist + private-IP block; no user-controlled URL hits an internal service.
- Dependency hygiene: lockfiles; `npm audit` / `pip-audit` / Trivy in CI; Renovate for updates; SBOM (CycloneDX) per release; images scanned + signed.
- Secrets scanning (gitleaks) in CI and on inbound webhook payloads before persistence.

## 8. Audit & tamper-evidence

- `audit_log` is append-only (no `UPDATE`/`DELETE` grant), monthly-partitioned, hash-chained (`hash = H(prev_hash || canonical(row))`).
- Recorded: auth events, RBAC changes, Run state transitions, every approval decision (+ rationale), config/policy/connector/provider changes, secret access (metadata only), every tool call, retention/delete operations, admin overrides.
- A daily verifier job walks the chain and alerts on a break. Export (JSON/CSV) for the customer's SIEM; optional OTLP log export.
- Retention: 2 years hot + 7 years archived (configurable up).

## 9. Data protection & privacy

- **In transit:** TLS 1.2+ external; mTLS internal.
- **At rest:** disk encryption assumed (infra); app-level encryption for secret material and (optional) for `work_item.body`/`raw` if a Tenant flags "sensitive tickets".
- **Redaction pipeline:** before any text is (a) sent to a provider or (b) written to logs/traces/artifacts — run secret-pattern + Tenant-regex + known-secret-value + optional PII scrub. Traces store the redacted form.
- **Model data policy:** per provider set no-train / zero-retention where supported; Router refuses providers that can't meet a Tenant's stated requirement; `data_region` pinning enforced.
- **Retention & deletion:** per-Tenant windows ([10](./10-database-architecture.md) §4); hard-delete request purges Postgres (incl. partitions), object storage, pgvector, Redis, and issues trace deletions; signed completion record.
- **Telemetry:** self-host sends **no** usage data externally unless the Tenant opts in; opt-in telemetry is aggregate + scrubbed.

## 10. Multi-tenant isolation summary

Query-layer tenant injection + Postgres RLS + `404`-on-cross-tenant + object-storage key prefixes + per-tenant event topics + per-tenant sandbox network namespaces + per-tenant budgets/concurrency (noisy-neighbor) + per-tenant secret scoping. SaaS (future): regional cells; large tenants can get a dedicated schema/DB and dedicated sandbox node pool.

## 11. Threat model (STRIDE, abridged)

| Threat | Example | Primary mitigations |
|--------|---------|--------------------|
| **Spoofing** | Forged webhook, stolen token | Signature verification; short-lived JWT + refresh-reuse detection; mTLS internal; service-account scoping |
| **Tampering** | Alter audit trail, poison memory, MITM | Hash-chained audit; memory writes are proposals + curator gate; TLS/mTLS; signed images |
| **Repudiation** | "I didn't approve that" | Every approval records actor + time + rationale; ChatOps decisions map to a real user; audit export |
| **Information disclosure** | Exfil secrets via prompt injection or logs | No secrets in context/sandbox; egress allowlist; redaction before provider + persistence; cross-tenant `404`; RLS |
| **Denial of service** | Runaway loop, model-cost bomb, connector flood | Per-Run + per-Tenant budgets/quotas/concurrency; loop guards; rate limits; circuit breakers; queue backpressure |
| **Elevation of privilege** | Operator approves own risky action; agent edits Policy | RBAC (Operator can't approve); Policy/`.praxis` edits are `forbidden` tier; promote gated to Admin/Owner; platform maxima cap Policy |

## 12. Security operations

- **SDLC:** threat-model review per epic; security review (`/security-review`) on PRs touching auth/sandbox/secrets/egress; SAST (CodeQL/Semgrep) + dependency + container scans as required CI gates.
- **Secrets in CI:** OIDC to cloud (no long-lived cloud creds in CI); test provider keys are low-budget, rotated.
- **Vuln management:** SLA — critical 72h, high 7d, medium 30d; monthly patch cadence for base images.
- **Pen test:** external test before GA; retest annually and after major arch changes; findings tracked to zero criticals/highs before GA sign-off (NFR-SEC-8).
- **Incident response:** runbooks for credential compromise, sandbox escape suspicion, provider key leak, tenant-data exposure; kill-switch to pause all Runs tenant-wide or platform-wide; forensic snapshot of a sandbox before teardown on suspicion.
- **Disclosure:** `security.txt`, a reporting address, and a coordinated-disclosure policy.
