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

export interface GitLabConfig {
  /** e.g. https://gitlab.edap.com.pk (self-hosted) or https://gitlab.com */
  baseUrl: string;
  /** full project path, e.g. huzaifahanif307/calculator (may contain subgroups) */
  projectPath: string;
  token: string;
}

/**
 * GitLab (self-hosted or SaaS) VcsProvider (prd/08). Talks REST v4 with a PRIVATE-TOKEN.
 * Single-repo per connector: `repo` args are accepted for interface conformance but the
 * configured `projectPath` is authoritative.
 */
export class GitLabVcsProvider implements VcsProvider {
  readonly id = "gitlab";
  private readonly log = new Logger("GitLabVcs");
  private readonly api: string;
  private readonly enc: string;

  constructor(private readonly cfg: GitLabConfig) {
    this.api = `${cfg.baseUrl.replace(/\/$/, "")}/api/v4`;
    this.enc = encodeURIComponent(cfg.projectPath);
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.api}${path}`, {
      ...init,
      headers: {
        "PRIVATE-TOKEN": this.cfg.token,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      throw new PraxisError("VCS_ERROR", `GitLab ${res.status}: ${body.slice(0, 300)}`, res.status >= 500 ? 502 : 400, {
        path,
      });
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  async healthCheck(): Promise<HealthStatus> {
    const t0 = Date.now();
    try {
      if (!this.cfg.projectPath) {
        const u = await this.call<{ username: string }>(`/user`);
        return {
          status: "healthy",
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - t0,
          detail: `token valid for @${u.username}`,
        };
      }
      const p = await this.call<{ id: number; path_with_namespace: string }>(`/projects/${this.enc}`);
      return {
        status: "healthy",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        detail: `project #${p.id} ${p.path_with_namespace}`,
      };
    } catch (e) {
      return { status: "down", checkedAt: new Date().toISOString(), detail: (e as Error).message };
    }
  }

  async listRepositories(): Promise<RepoRef[]> {
    const projects = await this.call<
      { id: number; path: string; namespace: { full_path: string }; default_branch: string; visibility: string; web_url: string; path_with_namespace: string }[]
    >(`/projects?membership=true&simple=true&per_page=50&order_by=last_activity_at`);
    return projects.map((p) => ({
      id: String(p.id),
      owner: p.namespace.full_path,
      name: p.path,
      url: p.web_url,
      defaultBranch: p.default_branch ?? "main",
      visibility: (p.visibility as RepoRef["visibility"]) ?? "private",
    }));
  }

  async getRepository(_repo: RepoId): Promise<RepoInfo> {
    const p = await this.call<{
      id: number;
      path: string;
      namespace: { full_path: string };
      default_branch: string;
      visibility: string;
      web_url: string;
    }>(`/projects/${this.enc}`);
    return {
      id: String(p.id),
      owner: p.namespace.full_path,
      name: p.path,
      url: p.web_url,
      defaultBranch: p.default_branch ?? "main",
      visibility: (p.visibility as RepoInfo["visibility"]) ?? "private",
    };
  }

  async listBranches(): Promise<BranchRef[]> {
    const branches = await this.call<{ name: string; commit: { id: string }; protected: boolean }[]>(
      `/projects/${this.enc}/repository/branches?per_page=100`,
    );
    return branches.map((b) => ({ name: b.name, sha: b.commit.id, protected: b.protected }));
  }

  async getProtectedBranches(): Promise<ProtectedRule[]> {
    const rules = await this.call<{ name: string }[]>(`/projects/${this.enc}/protected_branches`);
    return rules.map((r) => ({ pattern: r.name }));
  }

  async readFile(_repo: RepoId, ref: string, path: string): Promise<FileBlob> {
    const f = await this.call<{ content: string; encoding: string; blob_id: string }>(
      `/projects/${this.enc}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
    );
    return {
      path,
      ref,
      content: f.encoding === "base64" ? Buffer.from(f.content, "base64").toString("utf8") : f.content,
      encoding: "utf-8",
      sha: f.blob_id,
    };
  }

  /**
   * GitLab PATs are not short-lived-per-repo. Returns the configured token as an https
   * credential (username `oauth2`). Follow-up: mint a project access token with a TTL.
   */
  async mintEphemeralToken(): Promise<GitCredential> {
    return { scheme: "https-token", value: this.cfg.token, username: "oauth2" };
  }

  async createBranch(_repo: RepoId, fromRef: string, name: string): Promise<BranchRef> {
    const b = await this.call<{ name: string; commit: { id: string } }>(
      `/projects/${this.enc}/repository/branches?branch=${encodeURIComponent(name)}&ref=${encodeURIComponent(fromRef)}`,
      { method: "POST" },
    );
    return { name: b.name, sha: b.commit.id };
  }

  async openOrUpdatePullRequest(_repo: RepoId, input: PrInput): Promise<PullRequestRef> {
    // find an existing open MR for this source branch
    const existing = await this.call<{ iid: number; web_url: string; state: string }[]>(
      `/projects/${this.enc}/merge_requests?state=opened&source_branch=${encodeURIComponent(input.headBranch)}`,
    );
    if (existing[0]) {
      const mr = await this.call<{ iid: number; web_url: string; state: string }>(
        `/projects/${this.enc}/merge_requests/${existing[0].iid}`,
        { method: "PUT", body: JSON.stringify({ title: input.title, description: input.body }) },
      );
      return { number: mr.iid, url: mr.web_url, state: mrState(mr.state) };
    }
    const mr = await this.call<{ iid: number; web_url: string; state: string }>(
      `/projects/${this.enc}/merge_requests`,
      {
        method: "POST",
        body: JSON.stringify({
          source_branch: input.headBranch,
          target_branch: input.baseBranch,
          title: input.title,
          description: input.body,
          remove_source_branch: true,
          labels: (input.labels ?? []).join(","),
        }),
      },
    );
    return { number: mr.iid, url: mr.web_url, state: mrState(mr.state) };
  }

  async addPullRequestComment(_repo: RepoId, pr: number, body: string): Promise<CommentRef> {
    const note = await this.call<{ id: number }>(
      `/projects/${this.enc}/merge_requests/${pr}/notes`,
      { method: "POST", body: JSON.stringify({ body }) },
    );
    return { id: String(note.id) };
  }

  async getPullRequest(_repo: RepoId, pr: number): Promise<PullRequestInfo> {
    const mr = await this.call<{
      iid: number;
      web_url: string;
      state: string;
      source_branch: string;
      target_branch: string;
      merge_status: string;
      updated_at: string;
      reviewers?: { username: string }[];
    }>(`/projects/${this.enc}/merge_requests/${pr}`);
    return {
      number: mr.iid,
      url: mr.web_url,
      state: mrState(mr.state),
      headBranch: mr.source_branch,
      baseBranch: mr.target_branch,
      mergeable: mr.merge_status === "can_be_merged",
      reviewers: (mr.reviewers ?? []).map((r) => r.username),
      updatedAt: mr.updated_at,
    };
  }

  async listPullRequestChecks(_repo: RepoId, pr: number): Promise<CheckRun[]> {
    const pipelines = await this.call<{ id: number; status: string; web_url: string }[]>(
      `/projects/${this.enc}/merge_requests/${pr}/pipelines`,
    );
    return pipelines.map((p) => ({
      name: `pipeline #${p.id}`,
      status: p.status === "success" || p.status === "failed" || p.status === "canceled" ? "completed" : "in_progress",
      conclusion:
        p.status === "success" ? "success" : p.status === "failed" ? "failure" : p.status === "canceled" ? "cancelled" : undefined,
      url: p.web_url,
    }));
  }

  async ensureWebhook(_repo: RepoId, config: WebhookConfig): Promise<WebhookRef> {
    const hook = await this.call<{ id: number }>(`/projects/${this.enc}/hooks`, {
      method: "POST",
      body: JSON.stringify({
        url: config.url,
        token: config.secret,
        push_events: config.events.includes("push"),
        merge_requests_events: config.events.some((e) => e.startsWith("merge_request") || e.startsWith("pr")),
        note_events: config.events.includes("note") || config.events.includes("comment"),
        pipeline_events: config.events.includes("pipeline") || config.events.includes("checks"),
        enable_ssl_verification: true,
      }),
    });
    return { id: String(hook.id) };
  }

  verifyWebhook(headers: Record<string, string>, _rawBody: Buffer | string): { valid: boolean; event: string } {
    return { valid: true, event: headers["x-gitlab-event"] ?? "unknown" };
  }

  normalizeWebhook(headers: Record<string, string>, body: unknown): PlatformGitEvent[] {
    const b = body as Record<string, any>;
    const kind = headers["x-gitlab-event"];
    const repo: RepoId = { owner: this.cfg.projectPath.split("/")[0], name: this.cfg.projectPath.split("/").pop()! };
    if (kind === "Merge Request Hook") {
      const a = b.object_attributes ?? {};
      return [
        {
          type: a.action === "merge" ? "git.pr.merged" : a.action === "close" ? "git.pr.closed" : "git.pr.updated",
          repo,
          payload: {
            number: a.iid,
            state: a.state,
            url: a.url,
            headBranch: a.source_branch,
          },
        },
      ];
    }
    if (kind === "Push Hook") {
      return [{ type: "git.branch.updated", repo, payload: { ref: b.ref, after: b.after } }];
    }
    if (kind === "Note Hook") {
      return [{ type: "git.pr.comment", repo, payload: { note: b.object_attributes?.note } }];
    }
    if (kind === "Pipeline Hook") {
      return [{ type: "git.checks.updated", repo, payload: { status: b.object_attributes?.status } }];
    }
    return [];
  }

  capabilities(): VcsCapabilities {
    return {
      pullRequests: true,
      checksApi: true,
      protectedBranchApi: true,
      appAuth: false,
      ephemeralTokens: false,
    };
  }
}

function mrState(s: string): PullRequestRef["state"] {
  return s === "merged" ? "merged" : s === "closed" ? "closed" : "open";
}
