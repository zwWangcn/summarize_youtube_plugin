/**
 * OpenAI 兼容格式适配器。
 * 适用于：OpenAI、DeepSeek、Kimi、Qwen、GLM、Grok
 */

import type { AIRequest, BuiltRequest, ProviderAdapter, StreamChunk } from "./types";

function buildBody(params: AIRequest): string {
  return JSON.stringify({
    model: params.model,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: `以下是视频字幕内容：\n\n${params.transcript}` },
    ],
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.3,
    max_tokens: 16384,
  });
}

export const openaiCompatAdapter: ProviderAdapter = {
  buildStreamRequest(params: AIRequest): BuiltRequest {
    return {
      url: `${params.baseURL}/chat/completions`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: buildBody(params),
    };
  },

  parseStreamChunk(data: unknown): StreamChunk | null {
    const obj = data as Record<string, unknown>;
    if (!obj?.choices || !Array.isArray(obj.choices)) return null;

    const choice = obj.choices[0] as Record<string, unknown> | undefined;
    if (!choice) return null; // usage-only chunk

    const delta = choice.delta as Record<string, unknown> | undefined;
    const content = delta?.content as string | undefined;

    return {
      token: content,
      finishReason: choice.finish_reason as string | undefined,
    };
  },
};
