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

export interface GitLabTrackerConfig {
  baseUrl: string;
  projectPath: string;
  token: string;
}

interface GlIssue {
  iid: number;
  title: string;
  description: string | null;
  labels: string[];
  state: "opened" | "closed";
  assignee?: { username: string } | null;
  web_url: string;
  updated_at: string;
  author?: { username: string };
}

/** GitLab issues as a TrackerProvider (prd/09 §2). Same connector as the VcsProvider. */
export class GitLabTrackerProvider implements TrackerProvider {
  readonly id = "gitlab";
  private readonly log = new Logger("GitLabTracker");
  private readonly api: string;
  private readonly enc: string;

  constructor(private readonly cfg: GitLabTrackerConfig) {
    this.api = `${cfg.baseUrl.replace(/\/$/, "")}/api/v4`;
    this.enc = encodeURIComponent(cfg.projectPath);
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.api}${path}`, {
      ...init,
      headers: { "PRIVATE-TOKEN": this.cfg.token, "content-type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new PraxisError("VCS_ERROR", `GitLab ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`, 400);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  private toItem(i: GlIssue): TrackerItem {
    return {
      externalId: String(i.iid),
      externalUrl: i.web_url,
      title: i.title,
      body: i.description ?? "",
      labels: i.labels ?? [],
      assigneeExternalId: i.assignee?.username,
      state: i.state,
      raw: i as unknown as Record<string, unknown>,
      updatedAt: i.updated_at,
    };
  }

  async listItems(q: TrackerQuery): Promise<TrackerItem[]> {
    const params = new URLSearchParams({ per_page: "50", order_by: "updated_at", sort: "asc" });
    if (q.state) params.set("state", q.state === "open" ? "opened" : q.state);
    else params.set("state", "opened");
    if (q.labels?.length) params.set("labels", q.labels.join(","));
    if (q.since) params.set("updated_after", q.since);
    const issues = await this.call<GlIssue[]>(`/projects/${this.enc}/issues?${params}`);
    return issues.map((i) => this.toItem(i));
  }

  async getItem(externalId: string): Promise<TrackerItem> {
    const i = await this.call<GlIssue>(`/projects/${this.enc}/issues/${externalId}`);
    return this.toItem(i);
  }

  normalize(raw: TrackerItem): WorkItemDraft {
    return {
      source: "gitlab",
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
    await this.call(`/projects/${this.enc}/issues/${externalId}/notes`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  async transition(externalId: string, to: TrackerState): Promise<void> {
    const stateEvent = to === "done" || to === "rejected" ? "close" : "reopen";
    await this.call(`/projects/${this.enc}/issues/${externalId}`, {
      method: "PUT",
      body: JSON.stringify({ state_event: stateEvent }),
    });
  }

  async linkPullRequest(externalId: string, prUrl: string): Promise<void> {
    await this.comment(externalId, `🔧 Praxis opened a merge request: ${prUrl}`);
  }

  ingressWebhook(headers: Record<string, string>, body: unknown): { event: string; items: WorkItemDraft[] } {
    const b = body as Record<string, any>;
    const event = headers["x-gitlab-event"] ?? "unknown";
    if (event === "Issue Hook" && b.object_attributes) {
      const a = b.object_attributes;
      const item: TrackerItem = {
        externalId: String(a.iid),
        externalUrl: a.url,
        title: a.title,
        body: a.description ?? "",
        labels: (b.labels ?? []).map((l: { title: string }) => l.title),
        state: a.state,
        raw: b,
        updatedAt: a.updated_at ?? new Date().toISOString(),
      };
      return { event, items: [this.normalize(item)] };
    }
    return { event, items: [] };
  }

  async poll(since: string): Promise<{ items: WorkItemDraft[]; cursor: string }> {
    const items = await this.listItems({ since });
    return {
      items: items.map((i) => this.normalize(i)),
      cursor: items.at(-1)?.updatedAt ?? since,
    };
  }

  capabilities(): TrackerCapabilities {
    return { webhooks: true, transitions: true, acParsing: true, attachments: false };
  }
}

/** Pull checkbox / "Acceptance criteria" bullets out of an issue description. */
export function parseAcceptanceCriteria(body: string): string[] {
  if (!body) return [];
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (/^#{1,6}\s*(acceptance criteria|acceptance|done when|requirements)\b/i.test(line.trim())) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{1,6}\s/.test(line.trim())) inSection = false;
    const cb = line.match(/^\s*[-*]\s*\[[ xX]\]\s+(.*\S)/);
    if (cb) {
      out.push(cb[1].trim());
      continue;
    }
    if (inSection) {
      const bullet = line.match(/^\s*[-*]\s+(.*\S)/);
      if (bullet) out.push(bullet[1].trim());
    }
  }
  return [...new Set(out)].slice(0, 20);
}

function priorityFromLabels(labels: string[]): WorkItemDraft["priority"] {
  const l = labels.map((x) => x.toLowerCase());
  if (l.some((x) => /(^|::)(urgent|p0|critical)/.test(x))) return "urgent";
  if (l.some((x) => /(^|::)(high|p1)/.test(x))) return "high";
  if (l.some((x) => /(^|::)(low|p3|minor)/.test(x))) return "low";
  return "normal";
}
