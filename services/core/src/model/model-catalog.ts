import type { ModelCatalogEntry, ModelRequest, RoutingClass } from "@praxis/contracts";

/**
 * prd/07 §5. Static catalog for now — the LiteLLM `model_list` (infra/litellm/config.yaml)
 * is the multi-provider layer; adding a provider = a config entry + a row here. Per-tenant
 * overrides in a `model_catalog` table are a follow-up.
 *
 * `praxis-stub` is always present (LiteLLM mock_response) so the platform runs with zero keys.
 * The others activate once the matching provider key is set in .env / LiteLLM config.
 */
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    alias: "stub",
    provider: "litellm",
    model: "praxis-stub",
    contextWindow: 16000,
    maxOutput: 4000,
    capabilities: ["tools", "json_schema", "streaming"],
    priceInputPerMTok: 0,
    priceOutputPerMTok: 0,
    latencyClass: "fast",
    dataRegion: "self",
    enabled: true,
    weight: 1,
    fallbacks: [],
  },
  {
    alias: "fast",
    provider: "openai",
    model: "fast",
    contextWindow: 128000,
    maxOutput: 16000,
    capabilities: ["tools", "json_schema", "vision", "streaming"],
    priceInputPerMTok: 0.15,
    priceOutputPerMTok: 0.6,
    latencyClass: "fast",
    dataRegion: "us",
    enabled: false,
    fallbacks: ["stub"],
  },
  {
    alias: "strong",
    provider: "anthropic",
    model: "strong",
    contextWindow: 200000,
    maxOutput: 64000,
    capabilities: ["tools", "json_schema", "vision", "prompt_cache", "thinking", "streaming"],
    priceInputPerMTok: 3,
    priceOutputPerMTok: 15,
    latencyClass: "medium",
    dataRegion: "us",
    enabled: false,
    fallbacks: ["fast", "stub"],
  },
  {
    alias: "code",
    provider: "anthropic",
    model: "strong",
    contextWindow: 200000,
    maxOutput: 64000,
    capabilities: ["tools", "json_schema", "streaming"],
    priceInputPerMTok: 3,
    priceOutputPerMTok: 15,
    latencyClass: "medium",
    dataRegion: "us",
    enabled: false,
    fallbacks: ["strong", "fast", "stub"],
  },
  {
    alias: "gemini",
    provider: "google",
    model: "gemini",
    contextWindow: 1000000,
    maxOutput: 65000,
    capabilities: ["tools", "json_schema", "vision", "streaming"],
    priceInputPerMTok: 1.25,
    priceOutputPerMTok: 5,
    latencyClass: "medium",
    dataRegion: "us",
    enabled: false,
    fallbacks: ["strong", "fast", "stub"],
  },
];

const ROUTING_CLASS_ALIAS: Record<RoutingClass, string> = {
  fast: "fast",
  balanced: "strong",
  strong: "strong",
  code: "code",
  "long-context": "gemini",
};

const PURPOSE_ROUTING: Record<ModelRequest["purpose"], RoutingClass> = {
  triage: "fast",
  plan: "strong",
  code: "code",
  review: "strong",
  research: "strong",
  summarize: "fast",
  embed: "fast",
};

export function byAlias(alias: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((m) => m.alias === alias);
}

/**
 * Resolution order (prd/07 §5): explicit modelHint → routingClass → purpose default →
 * platform default. Falls back to the always-on `stub` if the resolved entry is disabled
 * (i.e. its provider key isn't configured) and has no enabled fallback.
 */
export function resolveModel(req: ModelRequest): ModelCatalogEntry {
  const candidates: string[] = [];
  if (req.modelHint) candidates.push(req.modelHint);
  if (req.routingClass) candidates.push(ROUTING_CLASS_ALIAS[req.routingClass]);
  candidates.push(ROUTING_CLASS_ALIAS[PURPOSE_ROUTING[req.purpose]]);
  candidates.push("stub");

  for (const alias of candidates) {
    const entry = byAlias(alias);
    if (entry?.enabled) return entry;
    // walk the entry's fallback chain for an enabled one
    for (const fb of entry?.fallbacks ?? []) {
      const fbEntry = byAlias(fb);
      if (fbEntry?.enabled) return fbEntry;
    }
  }
  return byAlias("stub")!;
}

/** Enable catalog entries whose provider key is present (called at boot). */
export function activateFromEnv(env: NodeJS.ProcessEnv): void {
  const has = (k: string) => !!env[k]?.trim();
  for (const m of MODEL_CATALOG) {
    if (m.provider === "openai" && has("OPENAI_API_KEY")) m.enabled = true;
    if (m.provider === "anthropic" && has("ANTHROPIC_API_KEY")) m.enabled = true;
    if (m.provider === "google" && has("GEMINI_API_KEY")) m.enabled = true;
  }
}
