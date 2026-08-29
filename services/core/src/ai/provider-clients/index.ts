import type { AiProviderKind } from "../../database/entities";
import { AnthropicClient } from "./anthropic.client";
import { GoogleClient } from "./google.client";
import { OpenAiClient } from "./openai.client";
import type { ProviderClient } from "./types";

export * from "./types";

const CLIENTS: Record<AiProviderKind, ProviderClient> = {
  openai: new OpenAiClient("openai"),
  "openai-compatible": new OpenAiClient("openai-compatible"),
  "azure-openai": new OpenAiClient("azure-openai"),
  anthropic: new AnthropicClient(),
  google: new GoogleClient(),
};

export function clientForKind(kind: AiProviderKind): ProviderClient {
  const c = CLIENTS[kind];
  if (!c) throw new Error(`no provider client for kind '${kind}'`);
  return c;
}

export const SUPPORTED_PROVIDER_KINDS = Object.keys(CLIENTS) as AiProviderKind[];

/** Suggested default models to seed when a provider is first added. */
export const DEFAULT_MODELS: Record<
  AiProviderKind,
  { alias: string; providerModel: string; routingClasses: string[]; contextWindow: number; maxOutput: number; priceIn: number; priceOut: number; capabilities: string[] }[]
> = {
  openai: [
    { alias: "fast", providerModel: "gpt-4o-mini", routingClasses: ["fast"], contextWindow: 128000, maxOutput: 16000, priceIn: 0.15, priceOut: 0.6, capabilities: ["tools", "json_schema", "vision"] },
    { alias: "strong", providerModel: "gpt-4o", routingClasses: ["balanced", "strong", "code"], contextWindow: 128000, maxOutput: 16000, priceIn: 2.5, priceOut: 10, capabilities: ["tools", "json_schema", "vision"] },
  ],
  anthropic: [
    { alias: "fast", providerModel: "claude-3-5-haiku-latest", routingClasses: ["fast"], contextWindow: 200000, maxOutput: 8000, priceIn: 0.8, priceOut: 4, capabilities: ["tools", "json_schema"] },
    { alias: "strong", providerModel: "claude-3-5-sonnet-latest", routingClasses: ["balanced", "strong", "code"], contextWindow: 200000, maxOutput: 64000, priceIn: 3, priceOut: 15, capabilities: ["tools", "json_schema", "vision", "prompt_cache"] },
  ],
  google: [
    // gemini-3.6-flash is on the Gemini API free tier; gemini-3.1-pro-preview needs a
    // billed project. Both are editable per tenant on the AI Providers screen.
    { alias: "fast", providerModel: "gemini-3.6-flash", routingClasses: ["fast", "code"], contextWindow: 1000000, maxOutput: 8000, priceIn: 0.075, priceOut: 0.3, capabilities: ["tools", "json_schema", "vision"] },
    { alias: "long-context", providerModel: "gemini-3.1-pro-preview", routingClasses: ["balanced", "strong", "long-context"], contextWindow: 2000000, maxOutput: 8000, priceIn: 1.25, priceOut: 5, capabilities: ["tools", "json_schema", "vision"] },
  ],
  "openai-compatible": [],
  "azure-openai": [],
};
