/**
 * AI API 客户端 — 多供应商分发器。
 * 根据用户选择的供应商和模型，委托给对应的适配器处理。
 */

import { getSettings } from "./storage";
import { getSystemPrompt } from "./prompts";
import { getProvider } from "./model-registry";
import { openaiCompatAdapter } from "./ai/openai-compat";
import { anthropicAdapter } from "./ai/anthropic";
import { geminiAdapter } from "./ai/gemini";
import type { ProviderAdapter } from "./ai/types";

const MAX_CHARS = 200_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Error types（保持公共 API 不变）
// ---------------------------------------------------------------------------
export class AIServiceError extends Error {
  /**
   * 是否值得重试。
   * - true：5xx、响应流异常等服务端/网络问题（默认）
   * - false：4xx 客户端错误、配置错误等，重试无益
   */
  constructor(message: string, public readonly retryable: boolean = true) {
    super(message);
    this.name = "AIServiceError";
  }
}

export class ContentFilteredError extends Error {
  constructor() {
    super("内容被安全过滤器拦截");
    this.name = "ContentFilteredError";
  }
}

export class NoApiKeyError extends Error {
  constructor(providerName?: string) {
    super(providerName
      ? `请先在扩展弹窗（点击工具栏图标）中配置 ${providerName} API Key`
      : "请先在扩展弹窗（点击工具栏图标）中配置 API Key");
    this.name = "NoApiKeyError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 根据 apiFormat 获取对应的适配器 */
function getAdapter(apiFormat: string): ProviderAdapter {
  switch (apiFormat) {
    case "anthropic-messages":
      return anthropicAdapter;
    case "gemini":
      return geminiAdapter;
    default:
      return openaiCompatAdapter;
  }
}

/** 加载当前生效的 provider、model、apiKey */
async function loadConfig() {
  const settings = await getSettings();
  const providerId = settings.provider || "deepseek";
  const modelId = settings.model || "deepseek-v4-flash";

  const provider = getProvider(providerId);
  if (!provider) {
    throw new AIServiceError(`未知供应商: ${providerId}`, false);
  }

  const apiKey = settings.apiKeys[providerId] ?? "";
  if (!apiKey) {
    throw new NoApiKeyError(provider.name);
  }

  const adapter = getAdapter(provider.apiFormat);

  return { provider, modelId, apiKey, adapter };
}

// ---------------------------------------------------------------------------
// Streaming summarization
// ---------------------------------------------------------------------------
export async function* summarizeTextStream(
  transcript: string,
  source: string | null = null,
): AsyncGenerator<string> {
  const { provider, modelId, apiKey, adapter } = await loadConfig();

  const text = transcript.length > MAX_CHARS ? transcript.slice(0, MAX_CHARS) : transcript;
  const systemPrompt = getSystemPrompt(source);

  let lastError: Error | null = null;
  // 流是否已向调用方交付过 token。一旦交付，重试会从头重新生成，
  // 导致前端 buffer 拼接出重复内容——故已交付的流不再重试。
  let yieldedAny = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const req = adapter.buildStreamRequest({
        model: modelId,
        systemPrompt,
        transcript: text,
        apiKey,
        baseURL: provider.baseURL,
      });

      const response = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: req.body,
      });

      if (!response.ok) {
        const errBody = await response.text();
        if (response.status >= 400 && response.status < 500) {
          // 4xx 客户端错误：Key 错误、请求格式错误等，重试无益
          console.warn("[vas] AI 4xx:", response.status, errBody.slice(0, 200));
          throw new AIServiceError(`API 请求被拒绝 (${response.status})，请检查 API Key 是否正确`, false);
        }
        // 5xx 服务端错误：可重试
        console.warn("[vas] AI 5xx:", response.status, errBody.slice(0, 200));
        throw new AIServiceError("AI 服务暂时不可用，请稍后重试", true);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new AIServiceError("无法读取响应流", true);

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;

            const dataStr = trimmed.slice(6);
            if (dataStr === "[DONE]") return;

            try {
              const data = JSON.parse(dataStr);
              const chunk = adapter.parseStreamChunk(data);

              if (chunk?.finishReason === "content_filter") {
                throw new ContentFilteredError();
              }

              if (chunk?.token) {
                yield chunk.token;
                yieldedAny = true;
              }
            } catch (e) {
              if (e instanceof ContentFilteredError) throw e;
              // Skip unparseable chunks
            }
          }
        }
      } finally {
        try { reader.releaseLock(); } catch { /* lock already released on stream error */ }
      }

      // 成功完成
      return;
    } catch (e) {
      lastError = e as Error;

      // 以下错误一律不重试，直接抛出：
      // 1. 配置/Key 缺失、内容过滤
      if (e instanceof NoApiKeyError || e instanceof ContentFilteredError) throw e;
      // 2. 已交付 token 的流——重试会导致前端内容重复拼接
      if (yieldedAny) throw e;
      // 3. 不可重试的 AIServiceError（4xx、配置错误等）
      if (e instanceof AIServiceError && !e.retryable) throw e;

      // 其余（5xx、网络错误等）在耗尽重试次数后抛出
      if (attempt === MAX_RETRIES) {
        throw e;
      }
    }
  }

  throw lastError ?? new AIServiceError("流式请求失败");
}

