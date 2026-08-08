/**
 * Anthropic Messages API 适配器。
 * API 格式：POST /v1/messages + x-api-key 头 + SSE 流式
 */

import type { AIRequest, BuiltRequest, ProviderAdapter, StreamChunk } from "./types";

function buildBody(params: AIRequest): string {
  const body: Record<string, unknown> = {
    model: params.model,
    system: [{ type: "text" as const, text: params.systemPrompt }],
    messages: [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: params.userPrompt }],
      },
    ],
    stream: true,
    max_tokens: params.maxOutputTokens ?? 16384,
  };
  if (typeof params.temperature === "number") body.temperature = params.temperature;
  return JSON.stringify(body);
}

export const anthropicAdapter: ProviderAdapter = {
  buildStreamRequest(params: AIRequest): BuiltRequest {
    return {
      url: `${params.baseURL}/messages`,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: buildBody(params),
    };
  },

  parseStreamChunk(data: unknown): StreamChunk | null {
    const obj = data as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return null;

    const type = obj.type as string;

    if (type === "error") {
      const error = obj.error as Record<string, unknown> | undefined;
      throw new Error(typeof error?.message === "string" ? error.message : "Anthropic stream error");
    }

    if (type === "content_block_delta") {
      const delta = obj.delta as Record<string, unknown> | undefined;
      const text = delta?.text as string | undefined;
      return text ? { token: text } : null;
    }

    if (type === "message_delta") {
      const delta = obj.delta as Record<string, unknown> | undefined;
      const stopReason = delta?.stop_reason as string | undefined;
      // refusal 表示内容被安全策略拒绝，统一映射为 content_filter
      return {
        finishReason: stopReason === "refusal" ? "content_filter" : stopReason,
      };
    }

    if (type === "message_stop") {
      return { finishReason: "stop" };
    }

    return null;
  },
};
