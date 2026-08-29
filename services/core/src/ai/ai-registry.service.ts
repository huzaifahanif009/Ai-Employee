import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { notFound, PraxisError } from "@praxis/contracts";
import { Repository } from "typeorm";
import { deriveKey, decryptSecret, encryptSecret, secretHint } from "../common/crypto";
import { AppConfig, CONFIG } from "../config/config";
import {
  AiModelEntity,
  AiProviderEntity,
  AiProviderKeyEntity,
  AiProviderKind,
} from "../database/entities";
import { clientForKind, DEFAULT_MODELS, SUPPORTED_PROVIDER_KINDS } from "./provider-clients";

export interface ResolvedModel {
  modelId: string; // ai_model row id
  alias: string;
  providerId: string;
  providerKind: AiProviderKind;
  baseUrl: string | null;
  config: Record<string, unknown>;
  providerModel: string;
  apiKey: string; // decrypted — held only for the outbound call
  priceInputPerMTok: number;
  priceOutputPerMTok: number;
  maxOutput: number;
  contextWindow: number;
}

const ROUTING_FOR_PURPOSE: Record<string, string> = {
  triage: "fast",
  plan: "strong",
  code: "code",
  review: "strong",
  research: "strong",
  summarize: "fast",
  embed: "fast",
};

@Injectable()
export class AiRegistryService {
  private readonly log = new Logger("AiRegistry");
  private readonly encKey: Buffer;

  constructor(
    @Inject(CONFIG) cfg: AppConfig,
    @InjectRepository(AiProviderEntity) private readonly providers: Repository<AiProviderEntity>,
    @InjectRepository(AiProviderKeyEntity) private readonly keys: Repository<AiProviderKeyEntity>,
    @InjectRepository(AiModelEntity) private readonly models: Repository<AiModelEntity>,
  ) {
    this.encKey = deriveKey(cfg.secretsEncryptionKey, cfg.jwtSecret);
  }

  supportedKinds() {
    return SUPPORTED_PROVIDER_KINDS;
  }

  // ---- read (masked) -------------------------------------------------------

  private keyView(k: AiProviderKeyEntity) {
    const { secretCiphertext, ...safe } = k;
    void secretCiphertext;
    return safe;
  }

  async listProviders(tenantId: string) {
    const [provs, keys, models] = await Promise.all([
      this.providers.find({ where: { tenantId }, order: { createdAt: "ASC" } }),
      this.keys.find({ where: { tenantId }, order: { createdAt: "ASC" } }),
      this.models.find({ where: { tenantId }, order: { alias: "ASC" } }),
    ]);
    return provs.map((p) => ({
      ...p,
      keys: keys.filter((k) => k.providerId === p.id).map((k) => this.keyView(k)),
      models: models.filter((m) => m.providerId === p.id),
    }));
  }

  listModels(tenantId: string) {
    return this.models.find({ where: { tenantId }, order: { alias: "ASC" } });
  }

  // ---- providers ---------------------------------------------------------

  async createProvider(
    tenantId: string,
    input: { kind: AiProviderKind; name: string; baseUrl?: string | null; config?: Record<string, unknown>; seedModels?: boolean },
  ) {
    if (!SUPPORTED_PROVIDER_KINDS.includes(input.kind)) {
      throw new PraxisError("VALIDATION", `unsupported provider kind '${input.kind}'`, 400);
    }
    const isFirst = (await this.providers.count({ where: { tenantId } })) === 0;
    const p = await this.providers.save(
      this.providers.create({
        tenantId,
        kind: input.kind,
        name: input.name,
        baseUrl: input.baseUrl?.trim() || null,
        config: input.config ?? {},
        enabled: true,
        isDefault: isFirst,
      }),
    );
    if (input.seedModels !== false) await this.seedDefaultModels(tenantId, p.id);
    return p;
  }

  async updateProvider(
    tenantId: string,
    id: string,
    patch: { name?: string; baseUrl?: string | null; config?: Record<string, unknown>; enabled?: boolean; isDefault?: boolean },
  ) {
    const p = await this.getProvider(tenantId, id);
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.baseUrl !== undefined) p.baseUrl = patch.baseUrl?.trim() || null;
    if (patch.config) p.config = { ...p.config, ...patch.config };
    if (patch.enabled !== undefined) p.enabled = patch.enabled;
    await this.providers.save(p);
    if (patch.isDefault) await this.setDefault(this.providers, { tenantId }, id);
    return this.getProvider(tenantId, id);
  }

  async deleteProvider(tenantId: string, id: string) {
    const p = await this.getProvider(tenantId, id);
    await this.models.delete({ tenantId, providerId: id });
    await this.keys.delete({ tenantId, providerId: id });
    await this.providers.remove(p);
    return { ok: true };
  }

  private getProvider(tenantId: string, id: string) {
    return this.providers.findOne({ where: { id, tenantId } }).then((p) => {
      if (!p) throw notFound("AiProvider", { id });
      return p;
    });
  }

  // ---- keys ------------------------------------------------------------

  async addKey(tenantId: string, providerId: string, input: { label: string; apiKey: string; isDefault?: boolean }) {
    await this.getProvider(tenantId, providerId);
    if (!input.apiKey?.trim()) throw new PraxisError("VALIDATION", "apiKey is required", 400);
    const isFirst = (await this.keys.count({ where: { tenantId, providerId } })) === 0;
    const k = await this.keys.save(
      this.keys.create({
        tenantId,
        providerId,
        label: input.label || "default",
        secretCiphertext: encryptSecret(input.apiKey.trim(), this.encKey),
        last4: secretHint(input.apiKey.trim()),
        enabled: true,
        isDefault: isFirst || !!input.isDefault,
        status: "untested",
      }),
    );
    if (k.isDefault) await this.setDefault(this.keys, { tenantId, providerId }, k.id);
    // fire-and-forget test
    void this.testKey(tenantId, k.id).catch(() => undefined);
    return this.keyView(await this.mustKey(tenantId, k.id));
  }

  async updateKey(
    tenantId: string,
    keyId: string,
    patch: { label?: string; apiKey?: string; enabled?: boolean; isDefault?: boolean },
  ) {
    const k = await this.mustKey(tenantId, keyId);
    if (patch.label !== undefined) k.label = patch.label;
    if (patch.enabled !== undefined) k.enabled = patch.enabled;
    if (patch.apiKey?.trim()) {
      k.secretCiphertext = encryptSecret(patch.apiKey.trim(), this.encKey);
      k.last4 = secretHint(patch.apiKey.trim());
      k.status = "untested";
      k.lastTestDetail = null;
    }
    await this.keys.save(k);
    if (patch.isDefault) await this.setDefault(this.keys, { tenantId, providerId: k.providerId }, keyId);
    if (patch.apiKey?.trim()) void this.testKey(tenantId, keyId).catch(() => undefined);
    return this.keyView(await this.mustKey(tenantId, keyId));
  }

  async deleteKey(tenantId: string, keyId: string) {
    const k = await this.mustKey(tenantId, keyId);
    await this.keys.remove(k);
    // if it was default, promote another enabled key
    const rest = await this.keys.find({ where: { tenantId, providerId: k.providerId } });
    if (rest.length && !rest.some((x) => x.isDefault)) {
      const pick = rest.find((x) => x.enabled) ?? rest[0];
      pick.isDefault = true;
      await this.keys.save(pick);
    }
    return { ok: true };
  }

  async testKey(tenantId: string, keyId: string) {
    const k = await this.mustKey(tenantId, keyId);
    const provider = await this.getProvider(tenantId, k.providerId);
    const apiKey = decryptSecret(k.secretCiphertext, this.encKey);
    let detail: string;
    let ok: boolean;
    try {
      const res = await clientForKind(provider.kind).test({ baseUrl: provider.baseUrl, apiKey, config: provider.config });
      ok = res.ok;
      detail = res.detail;
    } catch (e) {
      ok = false;
      detail = (e as Error).message;
    }
    // providers (esp. OpenAI) echo the key back in 401 bodies — scrub before persisting
    k.status = ok ? "valid" : "invalid";
    k.lastTestDetail = scrubKey(detail, apiKey).slice(0, 400);
    k.lastTestedAt = new Date();
    await this.keys.save(k);
    return { status: k.status, detail: k.lastTestDetail };
  }

  async listProviderModelIds(tenantId: string, providerId: string): Promise<string[]> {
    const provider = await this.getProvider(tenantId, providerId);
    const k = await this.defaultEnabledKey(tenantId, providerId);
    if (!k) return [];
    const client = clientForKind(provider.kind);
    if (!client.listModels) return [];
    return client.listModels({ baseUrl: provider.baseUrl, apiKey: decryptSecret(k.secretCiphertext, this.encKey), config: provider.config });
  }

  private mustKey(tenantId: string, keyId: string) {
    return this.keys.findOne({ where: { id: keyId, tenantId } }).then((k) => {
      if (!k) throw notFound("AiProviderKey", { id: keyId });
      return k;
    });
  }

  // ---- models --------------------------------------------------------

  async createModel(
    tenantId: string,
    input: {
      providerId: string;
      alias: string;
      providerModel: string;
      routingClasses?: string[];
      capabilities?: string[];
      contextWindow?: number;
      maxOutput?: number;
      priceInputPerMTok?: number;
      priceOutputPerMTok?: number;
      isDefault?: boolean;
    },
  ) {
    await this.getProvider(tenantId, input.providerId);
    if (await this.models.findOne({ where: { tenantId, alias: input.alias } })) {
      throw new PraxisError("CONFLICT", `a model with alias '${input.alias}' already exists`, 409);
    }
    const isFirst = (await this.models.count({ where: { tenantId } })) === 0;
    const m = await this.models.save(
      this.models.create({
        tenantId,
        providerId: input.providerId,
        alias: input.alias,
        providerModel: input.providerModel,
        routingClasses: input.routingClasses ?? [],
        capabilities: input.capabilities ?? [],
        contextWindow: input.contextWindow ?? 128000,
        maxOutput: input.maxOutput ?? 8000,
        priceInputPerMTok: String(input.priceInputPerMTok ?? 0),
        priceOutputPerMTok: String(input.priceOutputPerMTok ?? 0),
        enabled: true,
        isDefault: isFirst || !!input.isDefault,
      }),
    );
    if (m.isDefault) await this.setDefault(this.models, { tenantId }, m.id);
    return m;
  }

  async updateModel(
    tenantId: string,
    id: string,
    patch: Partial<{
      alias: string;
      providerModel: string;
      routingClasses: string[];
      capabilities: string[];
      contextWindow: number;
      maxOutput: number;
      priceInputPerMTok: number;
      priceOutputPerMTok: number;
      enabled: boolean;
      isDefault: boolean;
    }>,
  ) {
    const m = await this.mustModel(tenantId, id);
    if (patch.alias && patch.alias !== m.alias) {
      if (await this.models.findOne({ where: { tenantId, alias: patch.alias } })) {
        throw new PraxisError("CONFLICT", `alias '${patch.alias}' is taken`, 409);
      }
      m.alias = patch.alias;
    }
    if (patch.providerModel !== undefined) m.providerModel = patch.providerModel;
    if (patch.routingClasses !== undefined) m.routingClasses = patch.routingClasses;
    if (patch.capabilities !== undefined) m.capabilities = patch.capabilities;
    if (patch.contextWindow !== undefined) m.contextWindow = patch.contextWindow;
    if (patch.maxOutput !== undefined) m.maxOutput = patch.maxOutput;
    if (patch.priceInputPerMTok !== undefined) m.priceInputPerMTok = String(patch.priceInputPerMTok);
    if (patch.priceOutputPerMTok !== undefined) m.priceOutputPerMTok = String(patch.priceOutputPerMTok);
    if (patch.enabled !== undefined) m.enabled = patch.enabled;
    await this.models.save(m);
    if (patch.isDefault) await this.setDefault(this.models, { tenantId }, id);
    return this.mustModel(tenantId, id);
  }

  async deleteModel(tenantId: string, id: string) {
    await this.models.remove(await this.mustModel(tenantId, id));
    return { ok: true };
  }

  async seedDefaultModels(tenantId: string, providerId: string) {
    const provider = await this.getProvider(tenantId, providerId);
    for (const d of DEFAULT_MODELS[provider.kind] ?? []) {
      const alias = (await this.models.findOne({ where: { tenantId, alias: d.alias } })) ? `${d.alias}-${provider.kind}` : d.alias;
      if (await this.models.findOne({ where: { tenantId, alias } })) continue;
      await this.createModel(tenantId, {
        providerId,
        alias,
        providerModel: d.providerModel,
        routingClasses: d.routingClasses,
        capabilities: d.capabilities,
        contextWindow: d.contextWindow,
        maxOutput: d.maxOutput,
        priceInputPerMTok: d.priceIn,
        priceOutputPerMTok: d.priceOut,
      }).catch((e) => this.log.warn(`seed model ${alias}: ${(e as Error).message}`));
    }
  }

  private mustModel(tenantId: string, id: string) {
    return this.models.findOne({ where: { id, tenantId } }).then((m) => {
      if (!m) throw notFound("AiModel", { id });
      return m;
    });
  }

  // ---- resolution (for the Model Router) --------------------------------

  private async defaultEnabledKey(tenantId: string, providerId: string): Promise<AiProviderKeyEntity | null> {
    const rows = await this.keys.find({ where: { tenantId, providerId, enabled: true } });
    return rows.find((k) => k.isDefault) ?? rows[0] ?? null;
  }

  /** Decrypted API keys for all enabled keys — the Model Router feeds these into redaction. */
  async allActiveSecrets(tenantId: string): Promise<string[]> {
    const rows = await this.keys.find({ where: { tenantId, enabled: true } });
    return rows.map((k) => {
      try {
        return decryptSecret(k.secretCiphertext, this.encKey);
      } catch {
        return "";
      }
    }).filter(Boolean);
  }

  async resolve(
    tenantId: string,
    req: { modelHint?: string; routingClass?: string; purpose?: string },
  ): Promise<ResolvedModel | null> {
    const models = await this.models.find({ where: { tenantId, enabled: true } });
    if (models.length === 0) return null;

    const wantedClass = req.routingClass ?? (req.purpose ? ROUTING_FOR_PURPOSE[req.purpose] : undefined);

    const pick = (): AiModelEntity | undefined => {
      if (req.modelHint) {
        const byAlias = models.find((m) => m.alias === req.modelHint) ?? models.find((m) => m.providerModel === req.modelHint);
        if (byAlias) return byAlias;
      }
      if (wantedClass) {
        const inClass = models.filter((m) => m.routingClasses.includes(wantedClass));
        if (inClass.length) return inClass.find((m) => m.isDefault) ?? inClass[0];
      }
      return models.find((m) => m.isDefault) ?? models[0];
    };

    for (const model of dedupeOrder(pick(), models)) {
      const provider = await this.providers.findOne({ where: { id: model.providerId, tenantId, enabled: true } });
      if (!provider) continue;
      const key = await this.defaultEnabledKey(tenantId, provider.id);
      if (!key) continue;
      let apiKey: string;
      try {
        apiKey = decryptSecret(key.secretCiphertext, this.encKey);
      } catch {
        continue;
      }
      return {
        modelId: model.id,
        alias: model.alias,
        providerId: provider.id,
        providerKind: provider.kind,
        baseUrl: provider.baseUrl,
        config: provider.config,
        providerModel: model.providerModel,
        apiKey,
        priceInputPerMTok: Number(model.priceInputPerMTok),
        priceOutputPerMTok: Number(model.priceOutputPerMTok),
        maxOutput: model.maxOutput,
        contextWindow: model.contextWindow,
      };
    }
    return null;
  }

  // ---- helpers ------------------------------------------------------

  private async setDefault<T extends { id: string; isDefault: boolean }>(
    repo: Repository<T>,
    scope: Record<string, unknown>,
    id: string,
  ) {
    await repo.update(scope as never, { isDefault: false } as never);
    await repo.update({ id } as never, { isDefault: true } as never);
  }
}

/** Remove a credential from an error string a provider handed back (partial echoes included). */
export function scrubKey(text: string, apiKey: string): string {
  let out = text ?? "";
  if (apiKey.length >= 6) {
    out = out.split(apiKey).join("[redacted]");
    // partial echoes like "sk-fake...XYZ"
    const head = apiKey.slice(0, 6);
    out = out.replace(new RegExp(`${head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[A-Za-z0-9_.\\-]*`, "g"), "[redacted]");
  }
  return out
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, "[redacted]")
    .replace(/\bAIza[A-Za-z0-9_-]{10,}/g, "[redacted]")
    .replace(/\b(?:gh[pousr]|glpat|xox[baprs])[-_][A-Za-z0-9]{6,}/g, "[redacted]");
}

function dedupeOrder(first: AiModelEntity | undefined, all: AiModelEntity[]): AiModelEntity[] {
  const out: AiModelEntity[] = [];
  const seen = new Set<string>();
  for (const m of [first, ...all]) {
    if (m && !seen.has(m.id)) {
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}
