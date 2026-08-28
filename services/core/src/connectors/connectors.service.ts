import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { notFound, PraxisError } from "@praxis/contracts";
import type { VcsProvider } from "@praxis/contracts";
import { Repository } from "typeorm";
import { decryptSecret, deriveKey, encryptSecret, secretHint } from "../common/crypto";
import { AppConfig, CONFIG } from "../config/config";
import { ConnectorEntity, ConnectorKind, ProjectEntity } from "../database/entities";
import { GitLabVcsProvider } from "../vcs/gitlab.provider";

export interface CreateConnectorInput {
  kind: ConnectorKind;
  name: string;
  config: Record<string, unknown>; // { baseUrl, projectPath? }
  token: string;
}

const VCS_KINDS: ConnectorKind[] = ["gitlab", "github", "bitbucket", "generic-git"];

@Injectable()
export class ConnectorsService {
  private readonly log = new Logger("Connectors");
  private readonly key: Buffer;

  constructor(
    @Inject(CONFIG) cfg: AppConfig,
    @InjectRepository(ConnectorEntity) private readonly repo: Repository<ConnectorEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
  ) {
    this.key = deriveKey(cfg.secretsEncryptionKey, cfg.jwtSecret);
  }

  /** public view — never the ciphertext */
  private view(c: ConnectorEntity) {
    const { secretCiphertext, ...safe } = c;
    void secretCiphertext;
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
    if (input.kind !== "gitlab") {
      throw new PraxisError("VALIDATION", `only 'gitlab' is implemented so far (contract supports the rest)`, 400);
    }
    if (!input.token?.trim()) throw new PraxisError("VALIDATION", "token is required", 400);
    if (!input.config?.baseUrl) throw new PraxisError("VALIDATION", "config.baseUrl is required", 400);

    let c = this.repo.create({
      tenantId,
      kind: input.kind,
      name: input.name,
      contracts: ["vcs"],
      config: { baseUrl: String(input.config.baseUrl).replace(/\/$/, ""), projectPath: input.config.projectPath ?? null },
      authKind: "token",
      secretCiphertext: encryptSecret(input.token, this.key),
      secretHint: secretHint(input.token),
      status: "unconfigured",
    });
    c = await this.repo.save(c);
    await this.test(tenantId, c.id); // sets status
    return this.get(tenantId, c.id).then((x) => this.view(x));
  }

  async update(tenantId: string, id: string, patch: { name?: string; config?: Record<string, unknown>; token?: string }) {
    const c = await this.get(tenantId, id);
    if (patch.name) c.name = patch.name;
    if (patch.config) c.config = { ...c.config, ...patch.config };
    if (patch.token?.trim()) {
      c.secretCiphertext = encryptSecret(patch.token, this.key);
      c.secretHint = secretHint(patch.token);
    }
    await this.repo.save(c);
    await this.test(tenantId, id);
    return this.view(await this.get(tenantId, id));
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
      default:
        throw new PraxisError("VCS_ERROR", `no VcsProvider for kind ${c.kind}`, 500);
    }
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
    const host = String(c.config.baseUrl).replace(/^https?:\/\//, "");
    return {
      provider: this.resolveVcs(c),
      connector: c,
      token,
      cloneUrl: `https://oauth2:${token}@${host}/${path}.git`,
    };
  }
}
