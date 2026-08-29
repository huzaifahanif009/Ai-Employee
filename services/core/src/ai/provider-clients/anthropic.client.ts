import { ChatParams, ChatResult, jsonFetch, ProviderClient, TestResult } from "./types";

const VERSION = "2023-06-01";

/** Anthropic Messages API, normalised to the OpenAI-shaped ChatResult. */
export class AnthropicClient implements ProviderClient {
  readonly kind = "anthropic";

  private root(baseUrl?: string | null): string {
    return baseUrl?.replace(/\/$/, "") || "https://api.anthropic.com";
  }

  private headers(apiKey: string): Record<string, string> {
    return { "x-api-key": apiKey, "anthropic-version": VERSION, "content-type": "application/json" };
  }

  async test(p: { baseUrl?: string | null; apiKey: string }): Promise<TestResult> {
    try {
      await this.chat({ baseUrl: p.baseUrl, apiKey: p.apiKey, model: "claude-3-5-haiku-latest", messages: [{ role: "user", content: "ping" }], maxOutputTokens: 1 });
      return { ok: true, detail: "messages endpoint reachable" };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async chat(p: ChatParams): Promise<ChatResult> {
    const system = p.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const messages = p.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

    const { body } = await jsonFetch(
      `${this.root(p.baseUrl)}/v1/messages`,
      {
        method: "POST",
        headers: this.headers(p.apiKey),
        body: JSON.stringify({
          model: p.model,
          system: system || undefined,
          messages: messages.length ? messages : [{ role: "user", content: " " }],
          max_tokens: p.maxOutputTokens ?? 1024,
          temperature: p.temperature ?? 0.2,
        }),
      },
      p.timeoutMs,
    );

    const b = body as {
      model?: string;
      content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
    };
    const text = (b.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    const toolCalls = (b.content ?? [])
      .filter((c) => c.type === "tool_use")
      .map((c) => ({ id: c.id ?? "", name: c.name ?? "", arguments: c.input ?? {} }));

    return {
      model: b.model ?? p.model,
      text,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      finishReason: b.stop_reason === "end_turn" ? "stop" : b.stop_reason === "tool_use" ? "tool_calls" : b.stop_reason ?? "stop",
      usage: {
        inputTokens: b.usage?.input_tokens ?? 0,
        outputTokens: b.usage?.output_tokens ?? 0,
        cachedInputTokens: b.usage?.cache_read_input_tokens ?? 0,
      },
    };
  }
}
