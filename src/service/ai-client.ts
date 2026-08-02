/** AI 流式调用的内容脚本客户端；真正的 Key 读取和网络请求在后台执行。 */

import {
  AIServiceError,
  ContentFilteredError,
  NoApiKeyError,
  type ActiveAIIdentity,
  type StreamAIOptions,
} from "./ai";
import { AI_STREAM_PORT, type AIStreamEvent, type AIStreamRequest } from "./ai-stream-protocol";
import { getSystemPrompt } from "./prompts";
import { getSettings } from "./storage";
import type { OutputLanguage } from "../utils/i18n";

const MAX_CHARS = 200_000;

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function withMessage<T extends Error>(error: T, message: string): T {
  error.message = message;
  return error;
}

function restoreError(event: Extract<AIStreamEvent, { type: "error" }>): Error {
  switch (event.name) {
    case "NoApiKeyError":
      return withMessage(new NoApiKeyError(), event.message);
    case "ContentFilteredError":
      return withMessage(new ContentFilteredError(), event.message);
    case "AIServiceError":
      return new AIServiceError(event.message, event.retryable ?? true);
    case "AbortError":
      return abortError();
    default:
      return new Error(event.message);
  }
}

export async function getActiveAIIdentity(): Promise<ActiveAIIdentity> {
  const settings = await getSettings();
  return {
    providerId: settings.provider || "deepseek",
    modelId: settings.model || "deepseek-v4-flash",
  };
}

export async function* summarizeTextStream(
  transcript: string,
  outputLanguage: OutputLanguage = "zh-CN",
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const text = transcript.length > MAX_CHARS ? transcript.slice(0, MAX_CHARS) : transcript;
  const transcriptPrompt = `The following is the complete video transcript:\n\n${text}`;
  yield* streamAIText(
    getSystemPrompt(outputLanguage),
    transcriptPrompt,
    { disableThinking: true, signal },
  );
}

export async function* streamAIText(
  systemPrompt: string,
  userPrompt: string,
  options: StreamAIOptions = {},
): AsyncGenerator<string> {
  if (options.signal?.aborted) throw abortError();

  const port = chrome.runtime.connect({ name: AI_STREAM_PORT });
  const queue: AIStreamEvent[] = [];
  let wake: (() => void) | null = null;
  let completed = false;

  const enqueue = (event: AIStreamEvent) => {
    queue.push(event);
    wake?.();
    wake = null;
  };
  const onMessage = (event: AIStreamEvent) => {
    if (event.type === "done" || event.type === "error") completed = true;
    enqueue(event);
  };
  const onDisconnect = () => {
    if (!completed) {
      enqueue({
        type: "error",
        name: "AIServiceError",
        message: chrome.runtime.lastError?.message ?? "AI background connection closed",
        retryable: true,
      });
    }
  };
  const onAbort = () => {
    if (completed) return;
    completed = true;
    enqueue({ type: "error", name: "AbortError", message: "The operation was aborted" });
    try { port.disconnect(); } catch { /* already disconnected */ }
  };

  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(onDisconnect);
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const { signal: _signal, ...serializableOptions } = options;
  const request: AIStreamRequest = {
    type: "AI_STREAM_START",
    systemPrompt,
    userPrompt,
    options: serializableOptions,
  };
  port.postMessage(request);

  try {
    while (true) {
      if (!queue.length) {
        await new Promise<void>((resolve) => { wake = resolve; });
      }
      const event = queue.shift();
      if (!event) continue;
      if (event.type === "token") yield event.token;
      else if (event.type === "done") return;
      else throw restoreError(event);
    }
  } finally {
    completed = true;
    options.signal?.removeEventListener("abort", onAbort);
    port.onMessage.removeListener(onMessage);
    port.onDisconnect.removeListener(onDisconnect);
    try { port.disconnect(); } catch { /* already disconnected */ }
  }
}
