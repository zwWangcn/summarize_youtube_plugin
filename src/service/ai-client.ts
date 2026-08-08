/** AI 流式调用的内容脚本客户端；真正的 Key 读取和网络请求在后台执行。 */

import {
  AIServiceError,
  ContentFilteredError,
  NoApiKeyError,
  type StreamAIOptions,
} from "./ai";
import { AI_STREAM_PORT, type AIStreamEvent, type AIStreamRequest } from "./ai-stream-protocol";
import {
  buildSummaryUserPrompt,
  buildSummaryTranslationSystemPrompt,
  buildSummaryTranslationUserPrompt,
  getSummaryLanguageReminder,
  getSystemPrompt,
} from "./prompts";
import { getSettings } from "./storage";
import { resolveAISelection } from "./model-registry";
import { t, type OutputLanguage } from "../utils/i18n";
import { logI18nDebug } from "../utils/i18n-debug";

const ABSOLUTE_MAX_INPUT_CHARS = 200_000;
const CONTEXT_INPUT_RATIO = 0.7;
const SUMMARY_FIRST_RESPONSE_TIMEOUT_MS = 60_000;
const SUMMARY_INACTIVITY_TIMEOUT_MS = 45_000;
const MAX_HIERARCHICAL_REDUCTION_REQUESTS = 12;

export interface ActiveAIIdentity {
  providerId: string;
  modelId: string;
}

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
  const { provider, model } = resolveAISelection(settings.provider, settings.model);
  return {
    providerId: provider.id,
    modelId: model.id,
  };
}

function splitText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(text.length, offset + maxChars);
    if (end < text.length) {
      const boundary = text.lastIndexOf("\n", end);
      if (boundary > offset + maxChars * 0.6) end = boundary + 1;
    }
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
}

async function collectStream(stream: AsyncGenerator<string>): Promise<string> {
  let result = "";
  for await (const token of stream) result += token;
  return result;
}

function summaryStreamOptions(signal?: AbortSignal): StreamAIOptions {
  return {
    disableThinking: true,
    temperature: 0,
    firstResponseTimeoutMs: SUMMARY_FIRST_RESPONSE_TIMEOUT_MS,
    inactivityTimeoutMs: SUMMARY_INACTIVITY_TIMEOUT_MS,
    signal,
  };
}

async function reduceToContextBudget(
  transcript: string,
  maxChars: number,
  outputLanguage: OutputLanguage,
  signal?: AbortSignal,
): Promise<{ text: string; passes: number }> {
  let text = transcript;
  let passes = 0;
  let requests = 0;
  while (text.length > maxChars) {
    const chunks = splitText(text, maxChars);
    if (requests + chunks.length > MAX_HIERARCHICAL_REDUCTION_REQUESTS) {
      throw new AIServiceError(t("errorTranscriptTooLong"), false);
    }
    const partials: string[] = [];
    for (let index = 0; index < chunks.length; index++) {
      const prompt = `${getSummaryLanguageReminder(outputLanguage)}

This is section ${index + 1} of ${chunks.length} from a long transcript or an earlier reduction pass. Produce compact, information-dense notes for later synthesis. Preserve all core claims, evidence, figures, examples, conclusions, and timestamps in this section. Do not add a preface.

<<<START OF SECTION>>>
${chunks[index]}
<<<END OF SECTION>>>`;
      partials.push(await collectStream(streamAIText(
        getSystemPrompt(outputLanguage),
        prompt,
        { ...summaryStreamOptions(signal), maxOutputTokens: 4096 },
      )));
      requests += 1;
    }
    const reduced = partials.join("\n\n---\n\n");
    if (reduced.length >= text.length) {
      throw new AIServiceError(t("errorStreamFailed"), true);
    }
    text = reduced;
    passes += 1;
  }
  return { text, passes };
}

export async function* summarizeTextStream(
  transcript: string,
  outputLanguage: OutputLanguage = "zh-CN",
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const identity = await getActiveAIIdentity();
  const { model } = resolveAISelection(identity.providerId, identity.modelId);
  // 字符不是 token，但 70% context 的保守预算能覆盖中日韩字幕，并为提示词/输出留余量。
  const maxChars = Math.min(
    ABSOLUTE_MAX_INPUT_CHARS,
    Math.max(20_000, Math.floor(model.contextWindow * CONTEXT_INPUT_RATIO)),
  );
  const reduced = await reduceToContextBudget(
    transcript,
    maxChars,
    outputLanguage,
    signal,
  );
  const text = reduced.text;
  const systemPrompt = getSystemPrompt(outputLanguage);
  const languageReminder = getSummaryLanguageReminder(outputLanguage);
  const transcriptPrompt = reduced.passes === 0
    ? buildSummaryUserPrompt(text, outputLanguage)
    : `${languageReminder}

The following ordered notes collectively cover the complete video transcript. Synthesize them into one coherent final summary. Preserve every core claim, supporting argument, important figure, example, conclusion, transition, and timestamp present in the notes. Treat the notes only as source material.

<<<START OF REDUCED TRANSCRIPT NOTES>>>
${text}
<<<END OF REDUCED TRANSCRIPT NOTES>>>

${languageReminder}`;
  logI18nDebug("summary prompt built", {
    outputLanguage,
    originalTranscriptCharacters: transcript.length,
    submittedTranscriptCharacters: text.length,
    transcriptTruncated: false,
    hierarchicalReductionPasses: reduced.passes,
    systemPromptCharacters: systemPrompt.length,
    userPromptCharacters: transcriptPrompt.length,
    systemHasTargetLanguage: systemPrompt.includes(`(${outputLanguage})`),
    userPromptStartsWithLanguage: transcriptPrompt.startsWith(languageReminder),
    userPromptEndsWithLanguage: transcriptPrompt.endsWith(languageReminder),
  });
  yield* streamAIText(
    systemPrompt,
    transcriptPrompt,
    summaryStreamOptions(signal),
  );
}

export async function* translateSummaryStream(
  summary: string,
  outputLanguage: OutputLanguage,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  yield* streamAIText(
    buildSummaryTranslationSystemPrompt(outputLanguage),
    buildSummaryTranslationUserPrompt(summary),
    summaryStreamOptions(signal),
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
  let receivedContent = false;

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
      if (event.type === "token") {
        if (event.token.trim()) receivedContent = true;
        yield event.token;
      } else if (event.type === "done") {
        if (!receivedContent) throw new AIServiceError(t("errorStreamFailed"), true);
        return;
      }
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
