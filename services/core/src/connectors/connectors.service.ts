import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { notFound, PraxisError } from "@praxis/contracts";
import type { VcsProvider } from "@praxis/contracts";
import { Repository } from "typeorm";
import type { TrackerProvider } from "@praxis/contracts";
import { randomBytes } from "node:crypto";
import { decryptSecret, deriveKey, encryptSecret, secretHint } from "../common/crypto";
import {
  verifyWebhookSignature,
  webhookFamilyFor,
  type VerifyVerdict,
} from "../common/webhook-signature";
import { AppConfig, CONFIG } from "../config/config";
import { ConnectorEntity, ConnectorKind, ProjectEntity } from "../database/entities";
import { GitHubTrackerProvider } from "../tracker/github.tracker";
import { GitLabTrackerProvider } from "../tracker/gitlab.tracker";
import { GitHubVcsProvider } from "../vcs/github.provider";
import { GitLabVcsProvider } from "../vcs/gitlab.provider";

/** owner/repo from either a `path`/`projectPath` string or explicit fields */
function ownerRepo(config: Record<string, unknown>): { owner: string; repo: string } {
  if (config.owner && config.repo) return { owner: String(config.owner), repo: String(config.repo) };
  const path = String(config.projectPath ?? config.path ?? "");
  const parts = path.split("/").filter(Boolean);
  return { owner: parts.slice(0, -1).join("/"), repo: parts.at(-1) ?? "" };
}

export interface CreateConnectorInput {
  kind: ConnectorKind;
  name: string;
  config: Record<string, unknown>; // { baseUrl, projectPath? }
  token: string;
  webhookSecret?: string;
}

const VCS_KINDS: ConnectorKind[] = ["gitlab", "github", "bitbucket", "generic-git"];

@Injectable()
export class ConnectorsService {
  private readonly log = new Logger("Connectors");
  private readonly key: Buffer;
  private readonly requireWebhookSignature: boolean;

  constructor(
    @Inject(CONFIG) cfg: AppConfig,
    @InjectRepository(ConnectorEntity) private readonly repo: Repository<ConnectorEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
  ) {
    this.key = deriveKey(cfg.secretsEncryptionKey, cfg.jwtSecret);
    this.requireWebhookSignature = cfg.webhookRequireSignature;
  }

  /** public view — never any ciphertext */
  private view(c: ConnectorEntity) {
    const { secretCiphertext, webhookSecretCiphertext, ...safe } = c;
    void secretCiphertext;
    void webhookSecretCiphertext;
    return safe;
  }

  async list(tenantId: string) {
    const rows = await this.repo.find({ where: { tenantId }, order: { createdAt: "DESC" } });
    const projects = await this.projects.find({ where: { tenantId } });
    return rows.map((c) => ({
      ...this.view(c),
      usedByProjects: projects.filter((p) => p.vcsConnectorId === c.id).map((p) => ({ id: p.id, name: p.name })),
    }));
  }

  async get(tenantId: string, id: string) {
    const c = await this.repo.findOne({ where: { id, tenantId } });
    if (!c) throw notFound("Connector", { id });
    return c;
  }

  async create(tenantId: string, input: CreateConnectorInput) {
    if (!VCS_KINDS.includes(input.kind)) {
      throw new PraxisError("VALIDATION", `unsupported connector kind: ${input.kind}`, 400);
    }
    if (input.kind !== "gitlab" && input.kind !== "github") {
      throw new PraxisError("VALIDATION", `'${input.kind}' not implemented yet — use 'gitlab' or 'github'`, 400);
    }
    if (!input.token?.trim()) throw new PraxisError("VALIDATION", "token is required", 400);

    const baseUrl =
      (input.config.baseUrl as string | undefined)?.replace(/\/$/, "") ||
      (input.kind === "github" ? "https://api.github.com" : "");
    if (!baseUrl) throw new PraxisError("VALIDATION", "config.baseUrl is required", 400);

    const cfg: Record<string, unknown> = { baseUrl };
    if (input.kind === "gitlab") cfg.projectPath = input.config.projectPath ?? null;
    if (input.kind === "github") {
      const { owner, repo } = ownerRepo(input.config);
      cfg.owner = owner || null;
      cfg.repo = repo || null;
      cfg.projectPath = owner && repo ? `${owner}/${repo}` : null;
    }

    let c = this.repo.create({
      tenantId,
      kind: input.kind,
      name: input.name,
      contracts: ["vcs", "tracker"],
      config: cfg,
      authKind: "token",
      secretCiphertext: encryptSecret(input.token, this.key),
      secretHint: secretHint(input.token),
      webhookSecretCiphertext: input.webhookSecret?.trim()
        ? encryptSecret(input.webhookSecret.trim(), this.key)
        : null,
      webhookSecretHint: input.webhookSecret?.trim() ? secretHint(input.webhookSecret.trim()) : null,
      status: "unconfigured",
    });
    c = await this.repo.save(c);
    await this.test(tenantId, c.id); // sets status
    return this.get(tenantId, c.id).then((x) => this.view(x));
  }

  async update(
    tenantId: string,
    id: string,
    patch: { name?: string; config?: Record<string, unknown>; token?: string; webhookSecret?: string },
  ) {
    const c = await this.get(tenantId, id);
    if (patch.name) c.name = patch.name;
    if (patch.config) c.config = { ...c.config, ...patch.config };
    if (patch.token?.trim()) {
      c.secretCiphertext = encryptSecret(patch.token, this.key);
      c.secretHint = secretHint(patch.token);
    }
    if (patch.webhookSecret !== undefined) {
      const s = patch.webhookSecret.trim();
      c.webhookSecretCiphertext = s ? encryptSecret(s, this.key) : null;
      c.webhookSecretHint = s ? secretHint(s) : null;
    }
    await this.repo.save(c);
    await this.test(tenantId, id);
    return this.view(await this.get(tenantId, id));
  }

  /**
   * Generate a fresh inbound-webhook secret, store it encrypted, and return the
   * plaintext **once** so the operator can paste it into GitHub/GitLab. It is
   * never retrievable again — rotate to get a new one.
   */
  async rotateWebhookSecret(tenantId: string, id: string) {
    const c = await this.get(tenantId, id);
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    c.webhookSecretCiphertext = encryptSecret(secret, this.key);
    c.webhookSecretHint = secretHint(secret);
    await this.repo.save(c);
    const family = webhookFamilyFor(c.kind);
    return {
      secret,
      hint: c.webhookSecretHint,
      family,
      header: family === "github" ? "X-Hub-Signature-256 (HMAC-SHA256)" : "X-Gitlab-Token",
    };
  }

  /**
   * Authenticate an inbound webhook against the connector's stored secret
   * (prd/09 §5). GitHub → HMAC-SHA256 over the raw body; GitLab → shared token.
   * When `WEBHOOK_REQUIRE_SIGNATURE=false` an unsigned/unknown-family request is
   * allowed through (dev only) and logged.
   */
  verifyInboundWebhook(
    c: ConnectorEntity,
    headers: Record<string, string | undefined>,
    rawBody: Buffer | undefined,
  ): VerifyVerdict {
    const family = webhookFamilyFor(c.kind);
    if (!family) {
      if (this.requireWebhookSignature) {
        return { ok: false, status: 400, reason: `no webhook verification for kind ${c.kind}` };
      }
      this.log.warn(`webhook: unverifiable kind ${c.kind} allowed (WEBHOOK_REQUIRE_SIGNATURE=false)`);
      return { ok: true };
    }
    const secret = c.webhookSecretCiphertext
      ? decryptSecret(c.webhookSecretCiphertext, this.key)
      : "";
    if (!secret && !this.requireWebhookSignature) {
      this.log.warn(
        `webhook: connector ${c.id} has no secret; allowed (WEBHOOK_REQUIRE_SIGNATURE=false)`,
      );
      return { ok: true };
    }
    return verifyWebhookSignature({ family, secret, rawBody, headers });
  }

  async remove(tenantId: string, id: string) {
    const c = await this.get(tenantId, id);
    await this.projects.update({ tenantId, vcsConnectorId: id }, { vcsConnectorId: null });
    await this.repo.remove(c);
    return { ok: true };
  }

  async test(tenantId: string, id: string) {
    const c = await this.get(tenantId, id);
    const provider = this.resolveVcs(c);
    const health = await provider.healthCheck();
    c.status = health.status === "healthy" ? "healthy" : health.status === "degraded" ? "degraded" : "down";
    c.healthDetail = health.detail ?? null;
    c.lastHealthAt = new Date();
    await this.repo.save(c);
    return { status: c.status, detail: c.healthDetail, latencyMs: health.latencyMs };
  }

  async listRepos(tenantId: string, id: string) {
    const c = await this.get(tenantId, id);
    return this.resolveVcs(c).listRepositories({});
  }

  /** Build a VcsProvider from a stored connector (decrypts the token). */
  resolveVcs(c: ConnectorEntity): VcsProvider {
    if (!c.secretCiphertext) throw new PraxisError("VCS_ERROR", "connector has no credential", 400);
    const token = decryptSecret(c.secretCiphertext, this.key);
    switch (c.kind) {
      case "gitlab":
        return new GitLabVcsProvider({
          baseUrl: String(c.config.baseUrl),
          projectPath: String(c.config.projectPath ?? ""),
          token,
        });
      case "github": {
        const { owner, repo } = ownerRepo(c.config);
        return new GitHubVcsProvider({ baseUrl: String(c.config.baseUrl), owner, repo, token });
      }
      default:
        throw new PraxisError("VCS_ERROR", `no VcsProvider for kind ${c.kind}`, 500);
    }
  }

  resolveTracker(c: ConnectorEntity): TrackerProvider {
    if (!c.secretCiphertext) throw new PraxisError("VCS_ERROR", "connector has no credential", 400);
    const token = decryptSecret(c.secretCiphertext, this.key);
    if (c.kind === "gitlab") {
      return new GitLabTrackerProvider({
        baseUrl: String(c.config.baseUrl),
        projectPath: String(c.config.projectPath ?? ""),
        token,
      });
    }
    if (c.kind === "github") {
      const { owner, repo } = ownerRepo(c.config);
      return new GitHubTrackerProvider({ baseUrl: String(c.config.baseUrl), owner, repo, token });
    }
    throw new PraxisError("VCS_ERROR", `no TrackerProvider for kind ${c.kind}`, 500);
  }

  async getForTenant(tenantId: string, id: string): Promise<ConnectorEntity | null> {
    return this.repo.findOne({ where: { id, tenantId } });
  }

  /** tenant-agnostic — only for the public webhook route, which authenticates by connector id + optional token */
  async findAnyById(id: string): Promise<ConnectorEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  async resolveTrackerForProject(
    tenantId: string,
    projectId: string,
  ): Promise<{ provider: TrackerProvider; connector: ConnectorEntity } | null> {
    const project = await this.projects.findOne({ where: { id: projectId, tenantId } });
    if (!project?.trackerConnectorId) return null;
    const c = await this.repo.findOne({ where: { id: project.trackerConnectorId, tenantId } });
    if (!c?.secretCiphertext) return null;
    return { provider: this.resolveTracker(c), connector: c };
  }

  /** For the run flow: resolve the provider + decrypted token for a project's bound connector. */
  async resolveForProject(
    tenantId: string,
    projectId: string,
  ): Promise<{ provider: VcsProvider; connector: ConnectorEntity; token: string; cloneUrl: string } | null> {
    const project = await this.projects.findOne({ where: { id: projectId, tenantId } });
    if (!project?.vcsConnectorId) return null;
    const c = await this.repo.findOne({ where: { id: project.vcsConnectorId, tenantId } });
    if (!c?.secretCiphertext) return null;
    const token = decryptSecret(c.secretCiphertext, this.key);
    const path = String(c.config.projectPath ?? project.repoRef?.path ?? "");
    let cloneUrl: string;
    if (c.kind === "github") {
      // api.github.com → github.com for cloning; GHE keeps its host
      const apiHost = String(c.config.baseUrl).replace(/^https?:\/\//, "");
      const gitHost = apiHost === "api.github.com" ? "github.com" : apiHost.replace(/\/api\/v3$/, "");
      cloneUrl = `https://x-access-token:${token}@${gitHost}/${path}.git`;
    } else {
      const host = String(c.config.baseUrl).replace(/^https?:\/\//, "");
      cloneUrl = `https://oauth2:${token}@${host}/${path}.git`;
    }
    return { provider: this.resolveVcs(c), connector: c, token, cloneUrl };
  }
}
