# 08 — Git Provider Abstraction

## 1. Goals

- One contract (`VcsProvider`) for **GitHub, GitLab, Bitbucket, and generic Git** (FR-GIT-1..6).
- Adapters are independent packages; core has no provider imports.
- Never bypass protected-branch rules; never merge or force-push (FR-DELIVER-4, FR-GIT-5).
- Short-lived, path-scoped credentials minted per Run; nothing long-lived in the sandbox.
- Graceful degradation for hosts without a PR API.

## 2. Split of responsibilities

| Concern | Where | How |
|---------|-------|-----|
| Repo **content operations** (clone, checkout, add, commit, diff, push) | **inside the sandbox** | `git` CLI, driven by `git.*` tools, using a per-Run token |
| Repo **metadata & PR/MR operations** (list repos/branches, protected branches, open/update PR, comments, checks) | **control plane** (VCS Service) | provider REST APIs via adapters |
| **Webhooks** (push, PR events, comments) | control plane (Webhook Ingress → VCS Service) | signature-verified, normalized to platform events |
| **Auth** | control plane | GitHub App / GitLab token / Bitbucket app password / SSH key in secrets manager; mint scoped ephemeral tokens |

Rationale: content ops must happen where the checkout lives (the sandbox) and benefit from the battle-tested `git` binary; API ops need adapter logic and secrets that must never enter the sandbox.

## 3. `VcsProvider` contract

```ts
interface VcsProvider {
  id: 'github' | 'gitlab' | 'bitbucket' | 'generic';

  // --- discovery ---
  listRepositories(scope): Promise<RepoRef[]>;
  getRepository(repo: RepoId): Promise<RepoInfo>;                 // default branch, visibility, size
  listBranches(repo: RepoId): Promise<BranchRef[]>;
  getProtectedBranches(repo: RepoId): Promise<ProtectedRule[]>;   // patterns, required checks, review count
  readFile(repo: RepoId, ref: string, path: string): Promise<FileBlob>;  // API read w/o clone

  // --- credentials for in-sandbox git ---
  mintEphemeralToken(repo: RepoId, opts: { scopes: GitScope[]; ttlSeconds: number }): Promise<GitCredential>;
  // GitScope: 'contents:read' | 'contents:write' | 'pull_request:write' ...

  // --- change proposal ---
  createBranch(repo: RepoId, fromRef: string, name: string): Promise<BranchRef>;  // may be done via API or in-sandbox push
  openOrUpdatePullRequest(repo: RepoId, input: PrInput): Promise<PullRequestRef>;  // idempotent on head branch
  addPullRequestComment(repo: RepoId, pr: PrId, body: string, opts?): Promise<CommentRef>;
  getPullRequest(repo: RepoId, pr: PrId): Promise<PullRequestInfo>;               // state, mergeable, reviewers
  listPullRequestChecks(repo: RepoId, pr: PrId): Promise<CheckRun[]>;             // CI status
  linkIssue?(repo: RepoId, pr: PrId, issueRef: string): Promise<void>;

  // --- webhooks ---
  ensureWebhook(repo: RepoId, config: WebhookConfig): Promise<WebhookRef>;
  verifyWebhook(headers, rawBody): { valid: boolean; event: string };
  normalizeWebhook(headers, body): PlatformGitEvent[];

  capabilities(): VcsCapabilities;  // { pullRequests: bool, checksApi: bool, protectedBranchApi: bool, appAuth: bool, ... }
  healthCheck(): Promise<HealthStatus>;
}
```

```ts
interface PrInput {
  headBranch: string; baseBranch: string;
  title: string; body: string;            // full templated body (see §7)
  draft?: boolean;
  labels?: string[]; reviewers?: string[]; assignees?: string[];
  idempotencyKey: string;                 // (run_id + head branch) → update, never duplicate
}
```

## 4. Adapters

| Adapter | Library / API | Auth | PR term | Notes |
|---------|---------------|------|---------|-------|
| **github** | Octokit (`@octokit/rest` + app auth) | **GitHub App** (installation tokens, fine-grained), fallback PAT | Pull Request | Checks API, branch protection API, fine-grained ephemeral tokens native |
| **gitlab** | `@gitbeaker/rest` | Group/Project **access token** or OAuth; ephemeral via project access tokens or short-lived job-token pattern | Merge Request | Approvals API, pipelines as "checks", protected branches API |
| **bitbucket** | Bitbucket Cloud REST v2 (thin client) | **App password** / OAuth consumer / repo access token | Pull Request | No fine-grained ephemeral tokens → mint a scoped repo access token with short TTL where supported, else scope by key |
| **generic** | `git` CLI only (+ optional `isomorphic-git` for API-less metadata) | SSH deploy key or HTTPS user:token | *none* | `capabilities().pullRequests = false`; delivery = push branch + emit **patch Artifact** + instructions (FR-GIT-6) |

Adapter selection is per **Connector**; a Project references one Connector for its repo.

## 5. Credential handling

1. Connector stores the root credential (App private key / token / SSH key) in the **secrets manager**, referenced by id.
2. Per Run, VCS Service calls `mintEphemeralToken(repo, { scopes, ttl = Run wall-clock budget + margin })`:
   - GitHub → installation access token scoped to the one repo, `contents:write` + `pull_requests:write`.
   - GitLab → project access token (bot) with `write_repository`, TTL = 1 day min (GitLab granularity), revoked at Run end.
   - Bitbucket → repo access token if available, else a dedicated bot app password rotated per Project.
   - generic → the SSH key is mounted read-only into the sandbox as a `tmpfs` file for the Run only.
3. The ephemeral credential is passed to the runner over the authenticated broker channel and configured as the repo's `credential.helper` / `GIT_SSH_COMMAND` inside the microVM.
4. On Run end (any outcome) the token is revoked (where the API allows) and the sandbox is destroyed.
5. The credential value is **never** logged, never in `run_events`, never in the model context (Model Router redaction lists it).

## 6. In-sandbox `git.*` tools

| Tool | Action | Risk tier |
|------|--------|-----------|
| `git.status` | porcelain status | auto |
| `git.diff` | working/staged/ref diff (truncated + full Artifact) | auto |
| `git.branch` | create/switch working branch (name from template) | auto |
| `git.add` | stage paths (Policy path checks apply) | auto |
| `git.commit` | commit with message (conventional-commit lint) | auto |
| `git.log` | recent history | auto |
| `git.push` | push the working branch to origin (never `--force`, never to protected) | **notify** (or **approve** per Policy) |
| `git.reset` / `git.checkout --` | discard local changes | notify |
| `git.rebase` / `git.cherry-pick` | history ops on the working branch only | notify |

Guards enforced by the runner + Tool Broker: refuse pushes to `getProtectedBranches()` matches; refuse `--force`/`--force-with-lease`; refuse operations outside the repo working tree; branch name must match the Project template.

## 7. PR/MR body template (FR-DELIVER-2)

```
## Summary
<agent 2–4 sentence summary of the change>

## Ticket
<tracker key> — <title>   (link)

## Acceptance criteria
- [x] <criterion 1>  → <files / commits that satisfy it>
- [ ] <criterion N>  → <note if partially met>

## Changes
- <path> — <what changed and why>
...

## Verification
| Check | Result | Detail |
| build | ✅ | <log link> |
| lint  | ✅ | |
| unit  | ✅ 142 passed | <report link> |
| integration | ✅ | |
| e2e   | ✅ 7 scenarios | <artifact link> |
| coverage | +0.4% | |

## AI review
Verdict: <pass|concerns|block>
- <finding> (severity)
...

## Run
Praxis Run <run_id> · model(s): <provider/model list> · tokens: <n> · cost: $<x> · wall-clock: <mm:ss>
<dashboard link>

<!-- praxis:run=<run_id> head=<branch> -->  (machine marker for idempotent updates)
```

Idempotency: on delivery, `getPullRequest` by head branch; if one exists → `openOrUpdatePullRequest` updates title/body/labels and pushes new commits; else create. The HTML comment marker + `idempotencyKey` prevent duplicates across retries.

## 8. Webhooks → platform events

| Provider event | Platform event | Used for |
|----------------|----------------|----------|
| push (to a Praxis branch) | `git.branch.updated` | reflect external commits on the Run's branch |
| PR/MR opened/updated | `git.pr.updated` | dashboard PR state, "iterate on review" trigger |
| PR/MR review comment | `git.pr.comment` | (P2) feed follow-up commit loop |
| PR/MR merged | `git.pr.merged` | close the Run's WorkItem, record outcome, mark ticket done (via Tracker) |
| PR/MR closed unmerged | `git.pr.closed` | mark WorkItem `rejected` with reason |
| check_run/pipeline status | `git.checks.updated` | show external CI status alongside Praxis verification |

Ingress verifies the signature per provider (`X-Hub-Signature-256`, GitLab token, Bitbucket), dedupes by delivery id, and normalizes. Unknown/irrelevant events are dropped with a debug log.

## 9. Protected-branch & safety rules (hard, non-configurable)

- Never push to, or open a PR that targets its own head as, a protected branch.
- Never `--force` push.
- Never call a merge endpoint (the contract has **no merge method**).
- Never modify `.github/`, `.gitlab-ci.yml`, `.gitlab/`, `bitbucket-pipelines.yml`, CODEOWNERS, or branch-protection config unless the Project Policy explicitly allowlists that path **and** an Approval is granted.
- Respect `.praxis/deny-paths` in the repo (agent-authored guardrail the platform honors).

## 10. Multi-repo & monorepo notes (P1+)

- A Project targets one repo; a monorepo Project can set a `path_scope` so repo map, search, and Policy path checks are rooted at a subdirectory.
- Cross-repo changes (P2) require multiple Connectors + multiple PRs, orchestrated as sibling Runs with a shared parent WorkItem; each PR is independently reviewed/merged.

## 11. Contract tests

Run in CI per adapter against recorded cassettes + an opt-in live smoke suite (test org/repo):
create branch, read file at ref, mint ephemeral token (assert scope + TTL), open PR, update same PR (assert no duplicate), add comment, list checks, protected-branch detection, webhook verify + normalize for each event type, graceful `capabilities()` for `generic`.
