import { Uuid } from './common';

export interface MsgRef {
  channel: string;
  ts: string;
}

export interface ApprovalCard {
  approvalId: Uuid;
  runId: Uuid;
  title: string;
  type: string;
  evidenceLines: string[];
  actionPreview: string;
  slaAt: string;
  dashboardUrl: string;
}

export interface ChatInteraction {
  approvalId?: Uuid;
  decision?: 'approve' | 'reject';
  actorExternalId: string;
  raw: Record<string, unknown>;
}

export interface SlashCommand {
  command: string;
  args: string[];
  actorExternalId: string;
  channel: string;
  responseUrl?: string;
}

/** ADR-0004. Slack / MS Teams / Discord implement this. */
export interface ChatOpsProvider {
  readonly id: string;

  postMessage(channel: string, blocks: unknown): Promise<MsgRef>;
  updateMessage(ref: MsgRef, blocks: unknown): Promise<void>;
  postApproval(channel: string, approval: ApprovalCard): Promise<MsgRef>;

  onInteraction(payload: unknown): ChatInteraction;
  command(payload: unknown): SlashCommand;

  /** Map an external chat user id to a Praxis user for RBAC. */
  resolveUser(externalId: string): Promise<Uuid | null>;

  verifySignature(headers: Record<string, string>, rawBody: Buffer | string): boolean;
}
