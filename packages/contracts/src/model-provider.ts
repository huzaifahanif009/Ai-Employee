import { Attribution, HealthStatus, JsonSchema } from './common';

/** Normalized message content parts. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; mimeType?: string }
  | { type: 'file'; url: string; mimeType?: string };

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ContentPart[];
  toolCallId?: string;
  name?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export type RoutingClass = 'fast' | 'balanced' | 'strong' | 'code' | 'long-context';
export type ModelPurpose =
  | 'triage'
  | 'plan'
  | 'code'
  | 'review'
  | 'research'
  | 'summarize'
  | 'embed';

export interface ModelRequest {
  purpose: ModelPurpose;
  modelHint?: string;
  routingClass?: RoutingClass;
  messages: Message[];
  tools?: ToolSchema[];
  toolChoice?: 'auto' | 'none' | { name: string };
  responseFormat?: 'text' | 'json' | { jsonSchema: JsonSchema };
  maxOutputTokens?: number;
  temperature?: number;
  stream?: boolean;
  attribution: Attribution;
  dataPolicy?: { noTrain?: boolean; retention?: 'none' | 'provider-default' | string };
  cache?: { mode: 'off' | 'exact' | 'semantic'; ttlSeconds?: number };
  budgetPolicy?: { onSoftLimit: 'raiseApproval' | 'continue' };
  timeoutMs?: number;
}

export interface RouteAttempt {
  provider: string;
  model: string;
  attempt: number;
  outcome: 'ok' | 'retryable_error' | 'fatal_error';
  reason?: string;
  latencyMs: number;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  costUsd: number;
}

export interface ModelResponse {
  model: string;
  provider: string;
  content: ContentPart[];
  toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  usage: ModelUsage;
  routing: { attempts: RouteAttempt[]; cacheHit?: 'exact' | 'semantic' | null };
  latencyMs: number;
}

export type NormalizedStreamEvent =
  | { type: 'message.delta'; text: string }
  | { type: 'tool_call.delta'; id: string; name?: string; argsDelta: string }
  | { type: 'tool_call.done'; id: string }
  | { type: 'usage'; usage: ModelUsage }
  | { type: 'done'; response: ModelResponse }
  | { type: 'error'; message: string; retryable: boolean };

export type ProviderFeature =
  | 'tools'
  | 'json_schema'
  | 'vision'
  | 'files'
  | 'streaming'
  | 'prompt_cache'
  | 'thinking';

export interface ModelCatalogEntry {
  alias: string;
  provider: string;
  model: string;
  contextWindow: number;
  maxOutput: number;
  capabilities: ProviderFeature[];
  priceInputPerMTok: number;
  priceOutputPerMTok: number;
  priceCachedInputPerMTok?: number;
  latencyClass: 'fast' | 'medium' | 'slow';
  dataRegion: 'us' | 'eu' | 'self' | string;
  enabled: boolean;
  weight?: number;
  fallbacks?: string[];
}

/** Low-level adapter for one provider (usually reached via LiteLLM; native only where needed). */
export interface ProviderAdapter {
  readonly id: string;
  listModels(): Promise<ModelCatalogEntry[]>;
  supports(feature: ProviderFeature): boolean;
  complete(req: ModelRequest): Promise<ModelResponse>;
  stream(req: ModelRequest): AsyncIterable<NormalizedStreamEvent>;
  estimateCost(usage: Omit<ModelUsage, 'costUsd'>, model: string): number;
  healthCheck(): Promise<HealthStatus>;
}

/** The single egress point every service calls for LLM work (ADR-0003). */
export interface ModelRouter {
  complete(req: ModelRequest): Promise<ModelResponse>;
  stream(req: ModelRequest): AsyncIterable<NormalizedStreamEvent>;
  catalog(): Promise<ModelCatalogEntry[]>;
  healthCheck(): Promise<HealthStatus>;
}
