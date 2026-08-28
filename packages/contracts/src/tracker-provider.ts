import { IsoDateTime } from './common';

export interface TrackerQuery {
  since?: IsoDateTime;
  labels?: string[];
  assignee?: string;
  state?: string;
  limit?: number;
  cursor?: string;
}

export interface TrackerAttachment {
  name: string;
  url: string;
  mimeType?: string;
  sizeBytes?: number;
}

/** Raw tracker item as returned by the source system. */
export interface TrackerItem {
  externalId: string;
  externalUrl: string;
  title: string;
  body: string;
  labels: string[];
  priority?: string;
  assigneeExternalId?: string;
  state?: string;
  attachments?: TrackerAttachment[];
  raw: Record<string, unknown>;
  updatedAt: IsoDateTime;
}

/** Normalized shape the platform stores as a WorkItem. */
export interface WorkItemDraft {
  source: string;
  externalId: string;
  externalUrl: string;
  title: string;
  bodyMd: string;
  acceptanceCriteria: string[];
  labels: string[];
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  assigneeExternalId?: string;
  attachments: TrackerAttachment[];
  raw: Record<string, unknown>;
}

export type TrackerState = 'open' | 'in_progress' | 'in_review' | 'done' | 'rejected';

export interface TrackerCapabilities {
  webhooks: boolean;
  transitions: boolean;
  acParsing: boolean;
  attachments: boolean;
}

/** ADR-0004. GitHub Issues / Jira / Linear / EDAP Workdesk all implement this. */
export interface TrackerProvider {
  readonly id: string;

  listItems(query: TrackerQuery): Promise<TrackerItem[]>;
  getItem(externalId: string): Promise<TrackerItem>;
  normalize(raw: TrackerItem): WorkItemDraft;

  comment(externalId: string, body: string): Promise<void>;
  transition(externalId: string, to: TrackerState, opts?: Record<string, unknown>): Promise<void>;
  linkPullRequest?(externalId: string, prUrl: string): Promise<void>;

  ingressWebhook?(
    headers: Record<string, string>,
    body: unknown,
  ): { event: string; items: WorkItemDraft[] };
  poll(since: IsoDateTime): Promise<{ items: WorkItemDraft[]; cursor: string }>;

  capabilities(): TrackerCapabilities;
}
