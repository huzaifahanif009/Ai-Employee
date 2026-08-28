import { HealthStatus, IsoDateTime } from './common';

export interface RepoId {
  owner: string;
  name: string;
}

export interface RepoRef extends RepoId {
  id: string;
  url: string;
  defaultBranch: string;
  visibility: 'public' | 'private' | 'internal';
}

export interface RepoInfo extends RepoRef {
  sizeKb?: number;
  archived?: boolean;
}

export interface BranchRef {
  name: string;
  sha: string;
  protected?: boolean;
}

export interface ProtectedRule {
  pattern: string;
  requiredChecks?: string[];
  requiredApprovals?: number;
}

export interface FileBlob {
  path: string;
  ref: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  sha: string;
}

export type GitScope =
  | 'contents:read'
  | 'contents:write'
  | 'pull_request:read'
  | 'pull_request:write';

export interface GitCredential {
  scheme: 'https-token' | 'ssh-key';
  /** For https-token: the token to use as the password. For ssh-key: the private key material. */
  value: string;
  username?: string;
  expiresAt?: IsoDateTime;
}

export interface PrInput {
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
  draft?: boolean;
  labels?: string[];
  reviewers?: string[];
  assignees?: string[];
  /** (runId + headBranch) → update the same PR, never duplicate. */
  idempotencyKey: string;
}

export interface PullRequestRef {
  number: number;
  url: string;
  state: 'open' | 'closed' | 'merged';
}

export interface PullRequestInfo extends PullRequestRef {
  headBranch: string;
  baseBranch: string;
  mergeable?: boolean;
  reviewers?: string[];
  updatedAt: IsoDateTime;
}

export interface CheckRun {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'skipped';
  url?: string;
}

export interface CommentRef {
  id: string;
  url?: string;
}

export interface WebhookConfig {
  url: string;
  secret: string;
  events: string[];
}

export interface WebhookRef {
  id: string;
}

export interface PlatformGitEvent {
  type:
    | 'git.branch.updated'
    | 'git.pr.updated'
    | 'git.pr.comment'
    | 'git.pr.merged'
    | 'git.pr.closed'
    | 'git.checks.updated';
  repo: RepoId;
  payload: Record<string, unknown>;
}

export interface VcsCapabilities {
  pullRequests: boolean;
  checksApi: boolean;
  protectedBranchApi: boolean;
  appAuth: boolean;
  ephemeralTokens: boolean;
}

/** ADR-0004. GitHub / GitLab / Bitbucket / generic all implement this. */
export interface VcsProvider {
  readonly id: 'github' | 'gitlab' | 'bitbucket' | 'generic' | string;

  listRepositories(scope: { org?: string; query?: string }): Promise<RepoRef[]>;
  getRepository(repo: RepoId): Promise<RepoInfo>;
  listBranches(repo: RepoId): Promise<BranchRef[]>;
  getProtectedBranches(repo: RepoId): Promise<ProtectedRule[]>;
  readFile(repo: RepoId, ref: string, path: string): Promise<FileBlob>;

  mintEphemeralToken(
    repo: RepoId,
    opts: { scopes: GitScope[]; ttlSeconds: number },
  ): Promise<GitCredential>;

  createBranch(repo: RepoId, fromRef: string, name: string): Promise<BranchRef>;
  openOrUpdatePullRequest(repo: RepoId, input: PrInput): Promise<PullRequestRef>;
  addPullRequestComment(
    repo: RepoId,
    pr: number,
    body: string,
    opts?: { path?: string; line?: number },
  ): Promise<CommentRef>;
  getPullRequest(repo: RepoId, pr: number): Promise<PullRequestInfo>;
  listPullRequestChecks(repo: RepoId, pr: number): Promise<CheckRun[]>;
  linkIssue?(repo: RepoId, pr: number, issueRef: string): Promise<void>;

  ensureWebhook(repo: RepoId, config: WebhookConfig): Promise<WebhookRef>;
  verifyWebhook(
    headers: Record<string, string>,
    rawBody: Buffer | string,
  ): { valid: boolean; event: string };
  normalizeWebhook(
    headers: Record<string, string>,
    body: unknown,
  ): PlatformGitEvent[];

  capabilities(): VcsCapabilities;
  healthCheck(): Promise<HealthStatus>;
}
