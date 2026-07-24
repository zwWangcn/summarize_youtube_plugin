/**
 * Google Gemini API 适配器。
 * 流式：POST /v1beta/models/{model}:streamGenerateContent?alt=sse&key={apiKey}
 */

import type { AIRequest, BuiltRequest, ProviderAdapter, StreamChunk } from "./types";

/**
 * Gemini finishReason 中代表内容被安全过滤的取值。
 * 统一映射为 "content_filter"，供 ai.ts 识别并抛出 ContentFilteredError。
 * 详见 https://ai.google.dev/api/generate-content#finishreason
 */
const GEMINI_FILTER_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
]);

function buildBody(params: AIRequest): string {
  return JSON.stringify({
    systemInstruction: {
      parts: [{ text: params.systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: params.userPrompt }],
      },
    ],
    generationConfig: {
      temperature: params.temperature ?? 0.3,
      maxOutputTokens: params.maxOutputTokens ?? 16384,
    },
  });
}

export const geminiAdapter: ProviderAdapter = {
  buildStreamRequest(params: AIRequest): BuiltRequest {
    return {
      url: `${params.baseURL}/models/${params.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(params.apiKey)}`,
      headers: { "Content-Type": "application/json" },
      body: buildBody(params),
    };
  },

  parseStreamChunk(data: unknown): StreamChunk | null {
    const obj = data as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return null;

    // 整体拦截：prompt 被安全策略拒绝时，响应无 candidates，仅含 promptFeedback.blockReason
    const promptFeedback = obj.promptFeedback as Record<string, unknown> | undefined;
    if (promptFeedback?.blockReason) {
      return { finishReason: "content_filter" };
    }

    if (!obj.candidates || !Array.isArray(obj.candidates)) return null;

    const candidate = obj.candidates[0] as Record<string, unknown> | undefined;
    if (!candidate) return null;

    const content = candidate.content as { parts?: Array<{ text?: string }> } | undefined;
    const tokens = content?.parts?.map((p) => p.text ?? "").join("") ?? "";

    const rawReason = candidate.finishReason as string | undefined;
    const finishReason =
      rawReason && GEMINI_FILTER_REASONS.has(rawReason) ? "content_filter" : rawReason;

    return {
      token: tokens || undefined,
      finishReason,
    };
  },
};
