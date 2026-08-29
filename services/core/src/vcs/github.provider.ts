import { Logger } from "@nestjs/common";
import { PraxisError } from "@praxis/contracts";
import type {
  BranchRef,
  CheckRun,
  CommentRef,
  FileBlob,
  GitCredential,
  HealthStatus,
  PlatformGitEvent,
  PrInput,
  ProtectedRule,
  PullRequestInfo,
  PullRequestRef,
  RepoId,
  RepoInfo,
  RepoRef,
  VcsCapabilities,
  VcsProvider,
  WebhookConfig,
  WebhookRef,
} from "@praxis/contracts";

export interface GitHubConfig {
  /** https://api.github.com  (or https://ghe.example.com/api/v3 for Enterprise) */
  baseUrl: string;
  owner: string;
  repo: string;
  token: string;
}

/** GitHub (github.com or GHE) VcsProvider (prd/08). REST v3 with a PAT. */
export class GitHubVcsProvider implements VcsProvider {
  readonly id = "github";
  private readonly log = new Logger("GitHubVcs");
  private readonly base: string;
  private readonly nwo: string;

  constructor(private readonly cfg: GitHubConfig) {
    this.base = cfg.baseUrl.replace(/\/$/, "");
    this.nwo = `${cfg.owner}/${cfg.repo}`;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.cfg.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      throw new PraxisError("VCS_ERROR", `GitHub ${res.status}: ${body.slice(0, 300)}`, res.status >= 500 ? 502 : 400);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  async healthCheck(): Promise<HealthStatus> {
    const t0 = Date.now();
    try {
      if (!this.cfg.owner || !this.cfg.repo) {
        const u = await this.call<{ login: string }>(`/user`);
        return { status: "healthy", checkedAt: new Date().toISOString(), latencyMs: Date.now() - t0, detail: `token valid for @${u.login}` };
      }
      const r = await this.call<{ full_name: string; id: number }>(`/repos/${this.nwo}`);
      return { status: "healthy", checkedAt: new Date().toISOString(), latencyMs: Date.now() - t0, detail: `repo ${r.full_name} (#${r.id})` };
    } catch (e) {
      return { status: "down", checkedAt: new Date().toISOString(), detail: (e as Error).message };
    }
  }

  async listRepositories(): Promise<RepoRef[]> {
    const repos = await this.call<
      { id: number; name: string; owner: { login: string }; html_url: string; default_branch: string; private: boolean }[]
    >(`/user/repos?per_page=50&sort=updated`);
    return repos.map((r) => ({
      id: String(r.id),
      owner: r.owner.login,
      name: r.name,
      url: r.html_url,
      defaultBranch: r.default_branch,
      visibility: r.private ? "private" : "public",
    }));
  }

  async getRepository(): Promise<RepoInfo> {
    const r = await this.call<{ id: number; name: string; owner: { login: string }; html_url: string; default_branch: string; private: boolean }>(
      `/repos/${this.nwo}`,
    );
    return {
      id: String(r.id),
      owner: r.owner.login,
      name: r.name,
      url: r.html_url,
      defaultBranch: r.default_branch,
      visibility: r.private ? "private" : "public",
    };
  }

  async listBranches(): Promise<BranchRef[]> {
    const branches = await this.call<{ name: string; commit: { sha: string }; protected: boolean }[]>(
      `/repos/${this.nwo}/branches?per_page=100`,
    );
    return branches.map((b) => ({ name: b.name, sha: b.commit.sha, protected: b.protected }));
  }

  async getProtectedBranches(): Promise<ProtectedRule[]> {
    const branches = await this.call<{ name: string; protected: boolean }[]>(`/repos/${this.nwo}/branches?protected=true`);
    return branches.map((b) => ({ pattern: b.name }));
  }

  async readFile(_repo: RepoId, ref: string, path: string): Promise<FileBlob> {
    const f = await this.call<{ content: string; encoding: string; sha: string }>(
      `/repos/${this.nwo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
    );
    return {
      path,
      ref,
      content: f.encoding === "base64" ? Buffer.from(f.content, "base64").toString("utf8") : f.content,
      encoding: "utf-8",
      sha: f.sha,
    };
  }

  async mintEphemeralToken(): Promise<GitCredential> {
    // PAT is not short-lived; GitHub App installation tokens are a follow-up.
    return { scheme: "https-token", value: this.cfg.token, username: "x-access-token" };
  }

  async createBranch(_repo: RepoId, fromRef: string, name: string): Promise<BranchRef> {
    const base = await this.call<{ object: { sha: string } }>(`/repos/${this.nwo}/git/ref/heads/${encodeURIComponent(fromRef)}`);
    await this.call(`/repos/${this.nwo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${name}`, sha: base.object.sha }),
    });
    return { name, sha: base.object.sha };
  }

  async openOrUpdatePullRequest(_repo: RepoId, input: PrInput): Promise<PullRequestRef> {
    const existing = await this.call<{ number: number; html_url: string; state: string }[]>(
      `/repos/${this.nwo}/pulls?state=open&head=${encodeURIComponent(`${this.cfg.owner}:${input.headBranch}`)}`,
    );
    if (existing[0]) {
      const pr = await this.call<{ number: number; html_url: string; state: string }>(
        `/repos/${this.nwo}/pulls/${existing[0].number}`,
        { method: "PATCH", body: JSON.stringify({ title: input.title, body: input.body }) },
      );
      return { number: pr.number, url: pr.html_url, state: prState(pr.state) };
    }
    const pr = await this.call<{ number: number; html_url: string; state: string }>(`/repos/${this.nwo}/pulls`, {
      method: "POST",
      body: JSON.stringify({ head: input.headBranch, base: input.baseBranch, title: input.title, body: input.body, draft: input.draft ?? false }),
    });
    if (input.labels?.length) {
      await this.call(`/repos/${this.nwo}/issues/${pr.number}/labels`, {
        method: "POST",
        body: JSON.stringify({ labels: input.labels }),
      }).catch(() => undefined);
    }
    return { number: pr.number, url: pr.html_url, state: prState(pr.state) };
  }

  async addPullRequestComment(_repo: RepoId, pr: number, body: string): Promise<CommentRef> {
    const c = await this.call<{ id: number; html_url: string }>(`/repos/${this.nwo}/issues/${pr}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    return { id: String(c.id), url: c.html_url };
  }

  async getPullRequest(_repo: RepoId, pr: number): Promise<PullRequestInfo> {
    const p = await this.call<{
      number: number;
      html_url: string;
      state: string;
      merged: boolean;
      mergeable: boolean | null;
      head: { ref: string };
      base: { ref: string };
      updated_at: string;
      requested_reviewers?: { login: string }[];
    }>(`/repos/${this.nwo}/pulls/${pr}`);
    return {
      number: p.number,
      url: p.html_url,
      state: p.merged ? "merged" : prState(p.state),
      headBranch: p.head.ref,
      baseBranch: p.base.ref,
      mergeable: p.mergeable ?? undefined,
      reviewers: (p.requested_reviewers ?? []).map((r) => r.login),
      updatedAt: p.updated_at,
    };
  }

  async listPullRequestChecks(_repo: RepoId, pr: number): Promise<CheckRun[]> {
    const p = await this.call<{ head: { sha: string } }>(`/repos/${this.nwo}/pulls/${pr}`);
    const runs = await this.call<{ check_runs: { name: string; status: string; conclusion: string | null; html_url: string }[] }>(
      `/repos/${this.nwo}/commits/${p.head.sha}/check-runs`,
    );
    return runs.check_runs.map((c) => ({
      name: c.name,
      status: c.status === "completed" ? "completed" : c.status === "queued" ? "queued" : "in_progress",
      conclusion: (c.conclusion as CheckRun["conclusion"]) ?? undefined,
      url: c.html_url,
    }));
  }

  async ensureWebhook(_repo: RepoId, config: WebhookConfig): Promise<WebhookRef> {
    const hook = await this.call<{ id: number }>(`/repos/${this.nwo}/hooks`, {
      method: "POST",
      body: JSON.stringify({
        name: "web",
        active: true,
        events: config.events.length ? config.events : ["push", "pull_request", "issues", "issue_comment"],
        config: { url: config.url, secret: config.secret, content_type: "json", insecure_ssl: "0" },
      }),
    });
    return { id: String(hook.id) };
  }

  verifyWebhook(headers: Record<string, string>): { valid: boolean; event: string } {
    return { valid: true, event: headers["x-github-event"] ?? "unknown" };
  }

  normalizeWebhook(headers: Record<string, string>, body: unknown): PlatformGitEvent[] {
    const b = body as Record<string, any>;
    const event = headers["x-github-event"];
    const repo: RepoId = { owner: this.cfg.owner, name: this.cfg.repo };
    if (event === "pull_request") {
      const a = b.action;
      const merged = b.pull_request?.merged;
      return [
        {
          type: a === "closed" && merged ? "git.pr.merged" : a === "closed" ? "git.pr.closed" : "git.pr.updated",
          repo,
          payload: { number: b.pull_request?.number, state: b.pull_request?.state, url: b.pull_request?.html_url, headBranch: b.pull_request?.head?.ref },
        },
      ];
    }
    if (event === "push") return [{ type: "git.branch.updated", repo, payload: { ref: b.ref, after: b.after } }];
    if (event === "issue_comment") return [{ type: "git.pr.comment", repo, payload: { body: b.comment?.body } }];
    if (event === "check_run" || event === "check_suite" || event === "status")
      return [{ type: "git.checks.updated", repo, payload: { state: b.state ?? b.check_run?.conclusion } }];
    return [];
  }

  capabilities(): VcsCapabilities {
    return { pullRequests: true, checksApi: true, protectedBranchApi: true, appAuth: false, ephemeralTokens: false };
  }
}

const prState = (s: string): PullRequestRef["state"] => (s === "closed" ? "closed" : "open");
