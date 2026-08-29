import { ChatParams, ChatResult, jsonFetch, ProviderClient, TestResult } from "./types";

/** Google Gemini (Generative Language API), normalised to the OpenAI-shaped ChatResult. */
export class GoogleClient implements ProviderClient {
  readonly kind = "google";

  private root(baseUrl?: string | null): string {
    return baseUrl?.replace(/\/$/, "") || "https://generativelanguage.googleapis.com";
  }

  async test(p: { baseUrl?: string | null; apiKey: string }): Promise<TestResult> {
    try {
      const { body } = await jsonFetch(`${this.root(p.baseUrl)}/v1beta/models?key=${encodeURIComponent(p.apiKey)}`, {}, 10_000);
      const n = (body as { models?: unknown[] })?.models?.length ?? 0;
      return { ok: true, detail: `${n} models visible` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async listModels(p: { baseUrl?: string | null; apiKey: string }): Promise<string[]> {
    try {
      const { body } = await jsonFetch(`${this.root(p.baseUrl)}/v1beta/models?key=${encodeURIComponent(p.apiKey)}`, {}, 10_000);
      return ((body as { models?: { name: string }[] })?.models ?? [])
        .map((m) => m.name.replace(/^models\//, ""))
        .filter((n) => n.startsWith("gemini"))
        .sort();
    } catch {
      return [];
    }
  }

  async chat(p: ChatParams): Promise<ChatResult> {
    const system = p.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = p.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));

    const { body } = await jsonFetch(
      `${this.root(p.baseUrl)}/v1beta/models/${encodeURIComponent(p.model)}:generateContent?key=${encodeURIComponent(p.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: contents.length ? contents : [{ role: "user", parts: [{ text: " " }] }],
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: {
            temperature: p.temperature ?? 0.2,
            maxOutputTokens: p.maxOutputTokens ?? 1024,
            ...(p.responseFormat === "json" ? { responseMimeType: "application/json" } : {}),
          },
        }),
      },
      p.timeoutMs,
    );

    const b = body as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
    };
    const cand = b.candidates?.[0];
    return {
      model: p.model,
      text: (cand?.content?.parts ?? []).map((x) => x.text ?? "").join(""),
      finishReason: cand?.finishReason === "STOP" ? "stop" : cand?.finishReason?.toLowerCase() ?? "stop",
      usage: {
        inputTokens: b.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: b.usageMetadata?.candidatesTokenCount ?? 0,
        cachedInputTokens: b.usageMetadata?.cachedContentTokenCount ?? 0,
      },
    };
  }
}
