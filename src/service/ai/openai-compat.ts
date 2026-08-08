/**
 * OpenAI 兼容格式适配器。
 * 适用于：OpenAI、DeepSeek、Kimi、Qwen、GLM、Grok
 */

import type { AIRequest, BuiltRequest, ProviderAdapter, StreamChunk } from "./types";

function buildBody(params: AIRequest): string {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: [
      { role: params.instructionRole ?? "system", content: params.systemPrompt },
      { role: "user", content: params.userPrompt },
    ],
    stream: true,
  };
  if (typeof params.temperature === "number") body.temperature = params.temperature;
  body[params.maxOutputTokensField ?? "max_tokens"] = params.maxOutputTokens ?? 16384;
  if (params.disableThinking && params.thinkingControl === "deepseek") {
    body.thinking = { type: "disabled" };
  } else if (params.disableThinking && params.thinkingControl === "qwen") {
    body.enable_thinking = false;
  } else if (params.disableThinking && params.thinkingControl === "openai") {
    body.reasoning_effort = "minimal";
  }
  return JSON.stringify(body);
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
    const error = obj?.error as Record<string, unknown> | undefined;
    if (error) {
      throw new Error(typeof error.message === "string" ? error.message : "AI stream error");
    }
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
