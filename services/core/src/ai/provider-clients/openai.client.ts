import { ChatParams, ChatResult, jsonFetch, ProviderClient, TestResult } from "./types";

/** OpenAI + any OpenAI-compatible endpoint (vLLM, Together, OpenRouter, Groq…) + Azure OpenAI. */
export class OpenAiClient implements ProviderClient {
  constructor(readonly kind: "openai" | "openai-compatible" | "azure-openai" = "openai") {}

  private root(baseUrl?: string | null): string {
    return (baseUrl?.replace(/\/$/, "") || "https://api.openai.com/v1").replace(/\/$/, "");
  }

  private headers(apiKey: string, config?: Record<string, unknown>): Record<string, string> {
    if (this.kind === "azure-openai") return { "api-key": apiKey, "content-type": "application/json" };
    const h: Record<string, string> = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
    if (config?.organization) h["openai-organization"] = String(config.organization);
    return h;
  }

  private chatUrl(baseUrl: string | null | undefined, model: string, config?: Record<string, unknown>): string {
    if (this.kind === "azure-openai") {
      const dep = String(config?.deployment ?? model);
      const ver = String(config?.apiVersion ?? "2024-06-01");
      return `${this.root(baseUrl)}/openai/deployments/${dep}/chat/completions?api-version=${ver}`;
    }
    return `${this.root(baseUrl)}/chat/completions`;
  }

  async test(p: { baseUrl?: string | null; apiKey: string; config?: Record<string, unknown> }): Promise<TestResult> {
    try {
      if (this.kind === "azure-openai") {
        // Azure has no simple /models list; do a 1-token completion against the deployment.
        await this.chat({ ...p, apiKey: p.apiKey, model: String(p.config?.deployment ?? "gpt-4o-mini"), messages: [{ role: "user", content: "ping" }], maxOutputTokens: 1 });
        return { ok: true, detail: "deployment reachable" };
      }
      const { body } = await jsonFetch(`${this.root(p.baseUrl)}/models`, { headers: this.headers(p.apiKey, p.config) }, 10_000);
      const n = (body as { data?: unknown[] })?.data?.length ?? 0;
      return { ok: true, detail: `${n} models visible` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async listModels(p: { baseUrl?: string | null; apiKey: string; config?: Record<string, unknown> }): Promise<string[]> {
    if (this.kind === "azure-openai") return [];
    try {
      const { body } = await jsonFetch(`${this.root(p.baseUrl)}/models`, { headers: this.headers(p.apiKey, p.config) }, 10_000);
      return ((body as { data?: { id: string }[] })?.data ?? []).map((m) => m.id).sort();
    } catch {
      return [];
    }
  }

  async chat(p: ChatParams): Promise<ChatResult> {
    const { body } = await jsonFetch(
      this.chatUrl(p.baseUrl, p.model, p.config),
      {
        method: "POST",
        headers: this.headers(p.apiKey, p.config),
        body: JSON.stringify({
          model: p.model,
          messages: p.messages,
          temperature: p.temperature ?? 0.2,
          max_tokens: p.maxOutputTokens ?? 1024,
          ...(p.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
        }),
      },
      p.timeoutMs,
    );
    const b = body as {
      model?: string;
      choices?: { message?: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    const choice = b.choices?.[0];
    return {
      model: b.model ?? p.model,
      text: choice?.message?.content ?? "",
      toolCalls: choice?.message?.tool_calls?.map((t) => ({
        id: t.id,
        name: t.function.name,
        arguments: safeJson(t.function.arguments),
      })),
      finishReason: choice?.finish_reason ?? "stop",
      usage: {
        inputTokens: b.usage?.prompt_tokens ?? 0,
        outputTokens: b.usage?.completion_tokens ?? 0,
        cachedInputTokens: b.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
    };
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
