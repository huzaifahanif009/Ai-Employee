export interface ChatParams {
  baseUrl?: string | null;
  apiKey: string;
  model: string;
  config?: Record<string, unknown>;
  messages: { role: string; content: string }[];
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: "text" | "json";
  timeoutMs?: number;
}

export interface ChatResult {
  model: string;
  text: string;
  toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  finishReason: string;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
}

export interface TestResult {
  ok: boolean;
  detail: string;
}

/**
 * A provider adapter (prd/07 §4). Add a provider = implement this + register in index.ts.
 * All responses are normalised to the OpenAI-shaped `ChatResult` so the Model Router is
 * provider-agnostic.
 */
export interface ProviderClient {
  readonly kind: string;
  /** validate a credential without spending real tokens where possible */
  test(params: { baseUrl?: string | null; apiKey: string; config?: Record<string, unknown> }): Promise<TestResult>;
  /** list model ids the credential can see (best-effort; [] if unsupported) */
  listModels?(params: { baseUrl?: string | null; apiKey: string; config?: Record<string, unknown> }): Promise<string[]>;
  chat(params: ChatParams): Promise<ChatResult>;
}

export class ProviderHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export async function jsonFetch(
  url: string,
  init: RequestInit,
  timeoutMs = 60_000,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      (body as { error?: { message?: string } })?.error?.message ??
      (typeof body === "string" ? body : JSON.stringify(body))?.slice(0, 300);
    throw new ProviderHttpError(res.status, `${res.status} ${msg}`);
  }
  return { status: res.status, body };
}
