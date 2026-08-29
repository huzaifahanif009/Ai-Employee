import { Logger } from "@nestjs/common";
import { PraxisError } from "@praxis/contracts";
import type {
  TrackerCapabilities,
  TrackerItem,
  TrackerProvider,
  TrackerQuery,
  TrackerState,
  WorkItemDraft,
} from "@praxis/contracts";
import { parseAcceptanceCriteria } from "./gitlab.tracker";

export interface GitHubTrackerConfig {
  baseUrl: string;
  owner: string;
  repo: string;
  token: string;
}

interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  labels: ({ name: string } | string)[];
  state: "open" | "closed";
  assignee?: { login: string } | null;
  html_url: string;
  updated_at: string;
  pull_request?: unknown; // PRs show up in the issues list — filter them out
}

/** GitHub issues as a TrackerProvider (prd/09 §2). Same connector as the VcsProvider. */
export class GitHubTrackerProvider implements TrackerProvider {
  readonly id = "github";
  private readonly log = new Logger("GitHubTracker");
  private readonly base: string;
  private readonly nwo: string;

  constructor(private readonly cfg: GitHubTrackerConfig) {
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
    if (!res.ok) throw new PraxisError("VCS_ERROR", `GitHub ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`, 400);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  private labelNames(labels: GhIssue["labels"]): string[] {
    return labels.map((l) => (typeof l === "string" ? l : l.name));
  }

  private toItem(i: GhIssue): TrackerItem {
    return {
      externalId: String(i.number),
      externalUrl: i.html_url,
      title: i.title,
      body: i.body ?? "",
      labels: this.labelNames(i.labels),
      assigneeExternalId: i.assignee?.login,
      state: i.state,
      raw: i as unknown as Record<string, unknown>,
      updatedAt: i.updated_at,
    };
  }

  async listItems(q: TrackerQuery): Promise<TrackerItem[]> {
    const params = new URLSearchParams({ per_page: "50", sort: "updated", direction: "asc", state: q.state === "done" ? "closed" : "open" });
    if (q.labels?.length) params.set("labels", q.labels.join(","));
    if (q.since) params.set("since", q.since);
    const issues = await this.call<GhIssue[]>(`/repos/${this.nwo}/issues?${params}`);
    return issues.filter((i) => !i.pull_request).map((i) => this.toItem(i));
  }

  async getItem(externalId: string): Promise<TrackerItem> {
    return this.toItem(await this.call<GhIssue>(`/repos/${this.nwo}/issues/${externalId}`));
  }

  normalize(raw: TrackerItem): WorkItemDraft {
    return {
      source: "github",
      externalId: raw.externalId,
      externalUrl: raw.externalUrl,
      title: raw.title,
      bodyMd: raw.body,
      acceptanceCriteria: parseAcceptanceCriteria(raw.body),
      labels: raw.labels,
      priority: priorityFromLabels(raw.labels),
      assigneeExternalId: raw.assigneeExternalId,
      attachments: [],
      raw: raw.raw,
    };
  }

  async comment(externalId: string, body: string): Promise<void> {
    await this.call(`/repos/${this.nwo}/issues/${externalId}/comments`, { method: "POST", body: JSON.stringify({ body }) });
  }

  async transition(externalId: string, to: TrackerState): Promise<void> {
    await this.call(`/repos/${this.nwo}/issues/${externalId}`, {
      method: "PATCH",
      body: JSON.stringify({ state: to === "done" || to === "rejected" ? "closed" : "open" }),
    });
  }

  async linkPullRequest(externalId: string, prUrl: string): Promise<void> {
    await this.comment(externalId, `🔧 Praxis opened a pull request: ${prUrl}`);
  }

  ingressWebhook(headers: Record<string, string>, body: unknown): { event: string; items: WorkItemDraft[] } {
    const b = body as Record<string, any>;
    const event = headers["x-github-event"] ?? "unknown";
    if (event === "issues" && b.issue && ["opened", "edited", "reopened", "labeled"].includes(b.action)) {
      const item: TrackerItem = {
        externalId: String(b.issue.number),
        externalUrl: b.issue.html_url,
        title: b.issue.title,
        body: b.issue.body ?? "",
        labels: (b.issue.labels ?? []).map((l: { name: string }) => l.name),
        state: b.issue.state,
        raw: b,
        updatedAt: b.issue.updated_at ?? new Date().toISOString(),
      };
      return { event, items: [this.normalize(item)] };
    }
    return { event, items: [] };
  }

  async poll(since: string): Promise<{ items: WorkItemDraft[]; cursor: string }> {
    const items = await this.listItems({ since });
    return { items: items.map((i) => this.normalize(i)), cursor: items.at(-1)?.updatedAt ?? since };
  }

  capabilities(): TrackerCapabilities {
    return { webhooks: true, transitions: true, acParsing: true, attachments: false };
  }
}

function priorityFromLabels(labels: string[]): WorkItemDraft["priority"] {
  const l = labels.map((x) => x.toLowerCase());
  if (l.some((x) => /(urgent|p0|critical)/.test(x))) return "urgent";
  if (l.some((x) => /(high|p1)/.test(x))) return "high";
  if (l.some((x) => /(low|p3|minor)/.test(x))) return "low";
  return "normal";
}
