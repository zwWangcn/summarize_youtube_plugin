/**
 * AI API 客户端 — 多供应商分发器。
 * 根据用户选择的供应商和模型，委托给对应的适配器处理。
 */

import { getApiKey, getSettings } from "./storage";
import {
  getAIRequestProfile,
  resolveAISelection,
} from "./model-registry";
import { openaiCompatAdapter } from "./ai/openai-compat";
import { anthropicAdapter } from "./ai/anthropic";
import { geminiAdapter } from "./ai/gemini";
import type { ProviderAdapter } from "./ai/types";
import { t } from "../utils/i18n";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const DEFAULT_FIRST_RESPONSE_TIMEOUT_MS = 45_000;
const DEFAULT_INACTIVITY_TIMEOUT_MS = 45_000;

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function waitForRetryDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export interface StreamAIOptions {
  maxOutputTokens?: number;
  temperature?: number;
  disableThinking?: boolean;
  firstResponseTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

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
    super(t("errorContentFiltered"));
    this.name = "ContentFilteredError";
  }
}

export class NoApiKeyError extends Error {
  constructor(providerName?: string) {
    super(providerName
      ? t("errorApiKeyRequiredForProvider", providerName)
      : t("errorApiKeyRequired"));
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
  const { provider, model } = resolveAISelection(settings.provider, settings.model);

  const apiKey = await getApiKey(provider.id);
  if (!apiKey) {
    throw new NoApiKeyError(provider.name);
  }

  const adapter = getAdapter(provider.apiFormat);

  return { provider, modelId: model.id, apiKey, adapter };
}

function splitSSEEvents(
  input: string,
  flush: boolean = false,
): { blocks: string[]; remainder: string } {
  const blocks: string[] = [];
  let remainder = input;
  let boundary = remainder.search(/\r?\n\r?\n/);
  while (boundary >= 0) {
    blocks.push(remainder.slice(0, boundary));
    const separator = remainder.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
    remainder = remainder.slice(boundary + separator.length);
    boundary = remainder.search(/\r?\n\r?\n/);
  }
  if (flush && remainder.trim()) {
    blocks.push(remainder);
    remainder = "";
  }
  return { blocks, remainder };
}

function getSSEData(block: string): string | null {
  const dataLines: string[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine.startsWith("data:")) continue;
    const value = rawLine.slice(5);
    dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
  }
  return dataLines.length ? dataLines.join("\n") : null;
}

export async function* streamAIText(
  systemPrompt: string,
  userPrompt: string,
  options: StreamAIOptions = {},
): AsyncGenerator<string> {
  const { provider, modelId, apiKey, adapter } = await loadConfig();
  const profile = getAIRequestProfile(provider.id, modelId);

  let lastError: Error | null = null;
  // 流是否已向调用方交付过 token。一旦交付，重试会从头重新生成，
  // 导致前端 buffer 拼接出重复内容——故已交付的流不再重试。
  let yieldedAny = false;
  let yieldedContent = false;

  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) {
      throw abortError();
    }
    if (attempt > 0) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      await waitForRetryDelay(delay, options.signal);
    }

    try {
      const req = adapter.buildStreamRequest({
        model: modelId,
        systemPrompt,
        userPrompt,
        apiKey,
        baseURL: provider.baseURL,
        maxOutputTokens: options.maxOutputTokens,
        temperature: profile.supportsTemperature ? options.temperature : undefined,
        disableThinking: options.disableThinking,
        maxOutputTokensField: profile.maxOutputTokensField,
        thinkingControl: profile.thinkingControl,
        instructionRole: profile.instructionRole,
      });

      const controller = new AbortController();
      const abortFromCaller = () => controller.abort();
      options.signal?.addEventListener("abort", abortFromCaller, { once: true });
      let timeoutKind: "first-response" | "inactivity" = "first-response";
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const armTimeout = (kind: "first-response" | "inactivity", ms?: number) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutKind = kind;
        if (ms && ms > 0) timeoutId = setTimeout(() => controller.abort(), ms);
      };
      armTimeout(
        "first-response",
        options.firstResponseTimeoutMs ?? DEFAULT_FIRST_RESPONSE_TIMEOUT_MS,
      );

      try {
        const response = await fetch(req.url, {
          method: "POST",
          headers: req.headers,
          body: req.body,
          signal: controller.signal,
        });

        if (!response.ok) {
          const errBody = await response.text();
          if (response.status >= 400 && response.status < 500) {
            console.debug("[vas] AI 4xx:", response.status, errBody.slice(0, 200));
            throw new AIServiceError(t("errorApiRejected", String(response.status)), false);
          }
          console.debug("[vas] AI 5xx:", response.status, errBody.slice(0, 200));
          throw new AIServiceError(t("errorAiUnavailable"), true);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new AIServiceError(t("errorUnreadableStream"), true);

        const decoder = new TextDecoder();
        let buffer = "";
        let streamFinished = false;

        try {
          readStream: while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            armTimeout(
              "inactivity",
              options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS,
            );

            buffer += decoder.decode(value, { stream: true });
            const split = splitSSEEvents(buffer);
            buffer = split.remainder;

            for (const block of split.blocks) {
              const dataStr = getSSEData(block);
              if (dataStr === null) continue;
              if (dataStr.trim() === "[DONE]") {
                streamFinished = true;
                break readStream;
              }

              let data: unknown;
              try {
                data = JSON.parse(dataStr);
              } catch {
                throw new AIServiceError(t("errorStreamFailed"), true);
              }
              const chunk = adapter.parseStreamChunk(data);

              if (chunk?.finishReason === "content_filter") {
                throw new ContentFilteredError();
              }

              if (chunk?.token) {
                yield chunk.token;
                yieldedAny = true;
                if (chunk.token.trim()) yieldedContent = true;
              }
            }
          }

          if (!streamFinished) {
            buffer += decoder.decode();
            const split = splitSSEEvents(buffer, true);
            for (const block of split.blocks) {
              const dataStr = getSSEData(block);
              if (dataStr === null || dataStr.trim() === "[DONE]") continue;
              let data: unknown;
              try {
                data = JSON.parse(dataStr);
              } catch {
                throw new AIServiceError(t("errorStreamFailed"), true);
              }
              const chunk = adapter.parseStreamChunk(data);
              if (chunk?.finishReason === "content_filter") throw new ContentFilteredError();
              if (chunk?.token) {
                yield chunk.token;
                yieldedAny = true;
                if (chunk.token.trim()) yieldedContent = true;
              }
            }
          }
        } finally {
          try { reader.releaseLock(); } catch { /* lock already released on stream error */ }
        }

        if (!yieldedContent) {
          throw new AIServiceError(t("errorStreamFailed"), true);
        }
        return;
      } catch (error) {
        if (controller.signal.aborted) {
          if (options.signal?.aborted) {
            throw abortError();
          }
          const message = timeoutKind === "first-response"
            ? t("errorFirstResponseTimeout")
            : t("errorStreamStalled");
          throw new AIServiceError(message, true);
        }
        throw error;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        options.signal?.removeEventListener("abort", abortFromCaller);
      }
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
      if (attempt === maxRetries) {
        throw e;
      }
    }
  }

  throw lastError ?? new AIServiceError(t("errorStreamFailed"));
}
