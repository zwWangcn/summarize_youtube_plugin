import { streamAIText } from "./ai";
import type { Transcript, TranscriptSegment } from "../content/transcript";
import {
  getOutputLanguageInfo,
  t,
  type OutputLanguage,
} from "../utils/i18n";

// 12k chars keeps Japanese/other dense scripts plus JSON safely below the
// smallest configured providers' 16k output-token ceiling.
export const TARGET_CHARS_PER_CHUNK = 4_000;
const CONTEXT_SEGMENTS = 4;
const MAX_FORMAT_ATTEMPTS = 2;

export interface TranslatedSegment {
  start: number;
  duration: number;
  text: string;
}

export interface TranslationChunk {
  id: number;
  targetStart: number;
  targetEnd: number;
  contextStart: number;
  contextEnd: number;
}

interface ModelTranslation {
  sourceStartId: number;
  sourceEndId: number;
  translatedText: string;
}

export function buildTranslationSystemPrompt(targetLanguage: OutputLanguage): string {
  const { englishName } = getOutputLanguageInfo(targetLanguage);
  const scriptRule = targetLanguage === "zh-CN"
    ? "Use Simplified Chinese characters, not Traditional Chinese."
    : targetLanguage === "zh-TW"
      ? "Use Traditional Chinese characters, not Simplified Chinese."
      : "";
  return `You are a precise caption editor and translator. Translate the target captions into ${englishName} (${targetLanguage}) while repairing incorrect segmentation from automatic captions.

Strict rules:
1. Merge consecutive fragments that were split incorrectly and segment them by complete meaning.
2. Correct speech-recognition errors only when the context makes the correction highly certain. Otherwise translate faithfully without guessing or adding content.
3. Preserve names, product names, and technical terms in their original form where appropriate; write explanations in ${englishName}.
4. Do not summarize, omit, expand, explain, or comment on the content.
5. Cover only captions in TARGET. CONTEXT is provided only to understand boundaries.
6. Return NDJSON: one standalone JSON object per line, with no array, Markdown, or explanatory text. Every line must use this schema:
{"sourceStartId":integer,"sourceEndId":integer,"translatedText":"${englishName} text"}
7. Cover every TARGET ID exactly once and in order. Adjacent IDs may be merged, but IDs must never be skipped, overlapped, or reordered.
${scriptRule}

Final constraint: Every translatedText value must be written in ${englishName}.`;
}

export class TranslationFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationFormatError";
  }
}

export function buildTranslationChunks(
  segments: TranscriptSegment[],
  maxChars: number = TARGET_CHARS_PER_CHUNK,
): TranslationChunk[] {
  if (!segments.length) return [];
  const chunks: TranslationChunk[] = [];
  let start = 0;

  while (start < segments.length) {
    let end = start;
    let chars = 0;
    while (end < segments.length) {
      const nextLength = segments[end].text.length + 24;
      if (end > start && chars + nextLength > maxChars) break;
      chars += nextLength;
      end += 1;
    }
    const targetEnd = end - 1;
    chunks.push({
      id: chunks.length,
      targetStart: start,
      targetEnd,
      contextStart: Math.max(0, start - CONTEXT_SEGMENTS),
      contextEnd: Math.min(segments.length - 1, targetEnd + CONTEXT_SEGMENTS),
    });
    start = end;
  }

  return chunks;
}

function segmentLines(segments: TranscriptSegment[], start: number, end: number): string {
  const lines: string[] = [];
  for (let id = start; id <= end; id++) {
    lines.push(`${id}\t${JSON.stringify(segments[id].text)}`);
  }
  return lines.join("\n");
}

function buildUserPrompt(
  transcript: Transcript,
  chunk: TranslationChunk,
  previousInvalidOutput?: string,
): string {
  const before = chunk.contextStart < chunk.targetStart
    ? segmentLines(transcript.segments, chunk.contextStart, chunk.targetStart - 1)
    : "(none)";
  const target = segmentLines(transcript.segments, chunk.targetStart, chunk.targetEnd);
  const after = chunk.targetEnd < chunk.contextEnd
    ? segmentLines(transcript.segments, chunk.targetEnd + 1, chunk.contextEnd)
    : "(none)";
  const retry = previousInvalidOutput
    ? `\nThe previous output failed format or coverage validation. Return a corrected result without explanation. Previous output:\n${previousInvalidOutput.slice(0, 4000)}\n`
    : "";

  return `Source caption language code: ${transcript.languageCode}
TARGET ID range: ${chunk.targetStart}-${chunk.targetEnd}

CONTEXT BEFORE:
${before}

TARGET:
${target}

CONTEXT AFTER:
${after}
${retry}`;
}

function extractJsonArray(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw new TranslationFormatError(t("errorTranslationInvalidLine"));
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new TranslationFormatError(t("errorTranslationInvalidLine"));
  }
}

export function validateTranslationOutput(
  raw: string,
  targetStart: number,
  targetEnd: number,
): ModelTranslation[] {
  const parsed = extractJsonArray(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new TranslationFormatError(t("errorTranslationEmpty"));
  }

  const result: ModelTranslation[] = parsed.map((item) => {
    const value = item as Partial<ModelTranslation>;
    if (
      !Number.isInteger(value.sourceStartId) ||
      !Number.isInteger(value.sourceEndId) ||
      typeof value.translatedText !== "string" ||
      !value.translatedText.trim()
    ) {
      throw new TranslationFormatError(t("errorTranslationInvalidItem"));
    }
    return {
      sourceStartId: value.sourceStartId!,
      sourceEndId: value.sourceEndId!,
      translatedText: value.translatedText.trim(),
    };
  });

  let expected = targetStart;
  for (const item of result) {
    if (item.sourceStartId !== expected || item.sourceEndId < item.sourceStartId) {
      throw new TranslationFormatError(t("errorTranslationInvalidCoverage"));
    }
    expected = item.sourceEndId + 1;
  }
  if (expected !== targetEnd + 1) {
    throw new TranslationFormatError(t("errorTranslationIncomplete"));
  }

  return result;
}

export function validateTranslationLine(
  rawLine: string,
  expectedStart: number,
  targetEnd: number,
): ModelTranslation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine.trim());
  } catch {
    throw new TranslationFormatError(t("errorTranslationInvalidLine"));
  }
  const value = parsed as Partial<ModelTranslation>;
  if (
    !Number.isInteger(value.sourceStartId) ||
    !Number.isInteger(value.sourceEndId) ||
    typeof value.translatedText !== "string" ||
    !value.translatedText.trim()
  ) {
    throw new TranslationFormatError(t("errorTranslationInvalidLineFields"));
  }
  if (
    value.sourceStartId !== expectedStart ||
    value.sourceEndId! < value.sourceStartId! ||
    value.sourceEndId! > targetEnd
  ) {
    throw new TranslationFormatError(t("errorTranslationOutOfRange"));
  }
  return {
    sourceStartId: value.sourceStartId!,
    sourceEndId: value.sourceEndId!,
    translatedText: value.translatedText.trim(),
  };
}

async function translateChunk(
  transcript: Transcript,
  chunk: TranslationChunk,
  targetLanguage: OutputLanguage,
  onPartial?: (items: ModelTranslation[], attempt: number) => void,
  signal?: AbortSignal,
): Promise<ModelTranslation[]> {
  let previousOutput = "";
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_FORMAT_ATTEMPTS; attempt++) {
    let rawOutput = "";
    let lineBuffer = "";
    let expectedStart = chunk.targetStart;
    const items: ModelTranslation[] = [];
    onPartial?.([], attempt);

    try {
      const consumeLine = (rawLine: string) => {
        const line = rawLine.trim();
        if (!line || line === "```" || line === "```json" || line === "```ndjson") return;
        const item = validateTranslationLine(line, expectedStart, chunk.targetEnd);
        items.push(item);
        expectedStart = item.sourceEndId + 1;
        onPartial?.([...items], attempt);
      };

      for await (const token of streamAIText(
        buildTranslationSystemPrompt(targetLanguage),
        buildUserPrompt(transcript, chunk, attempt > 0 ? previousOutput : undefined),
        {
          maxOutputTokens: 16384,
          temperature: 0.1,
          disableThinking: true,
          firstResponseTimeoutMs: 30_000,
          inactivityTimeoutMs: 45_000,
          maxRetries: 1,
          signal,
        },
      )) {
        rawOutput += token;
        lineBuffer += token;
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) consumeLine(line);
      }
      if (lineBuffer.trim()) consumeLine(lineBuffer);
      if (expectedStart !== chunk.targetEnd + 1) {
        throw new TranslationFormatError(t("errorTranslationIncomplete"));
      }
      return items;
    } catch (error) {
      if (!(error instanceof TranslationFormatError)) throw error;
      lastError = error as Error;
      previousOutput = rawOutput;
    }
  }

  throw lastError ?? new TranslationFormatError(t("errorTranslationValidation"));
}

function toTranslatedSegments(
  transcript: Transcript,
  items: ModelTranslation[],
): TranslatedSegment[] {
  return items.map((item) => {
    const first = transcript.segments[item.sourceStartId];
    const last = transcript.segments[item.sourceEndId];
    const end = last.start + last.duration;
    return {
      start: first.start,
      duration: Math.max(0, end - first.start),
      text: item.translatedText,
    };
  });
}

export async function translateTranscriptChunk(
  transcript: Transcript,
  chunk: TranslationChunk,
  targetLanguage: OutputLanguage,
  onProgress?: (partial: TranslatedSegment[], formatRetry: boolean) => void,
  signal?: AbortSignal,
): Promise<TranslatedSegment[]> {
  const items = await translateChunk(transcript, chunk, targetLanguage, (partialItems, attempt) => {
    onProgress?.(toTranslatedSegments(transcript, partialItems), attempt > 0);
  }, signal);
  return toTranslatedSegments(transcript, items);
}

export async function translateTranscript(
  transcript: Transcript,
  targetLanguage: OutputLanguage,
  onProgress?: (
    completed: number,
    total: number,
    partial: TranslatedSegment[],
    formatRetry: boolean,
  ) => void,
): Promise<TranslatedSegment[]> {
  const chunks = buildTranslationChunks(transcript.segments);
  const translated: TranslatedSegment[] = [];

  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    const items = await translateChunk(transcript, chunk, targetLanguage, (partialItems, attempt) => {
      onProgress?.(
        index,
        chunks.length,
        [...translated, ...toTranslatedSegments(transcript, partialItems)],
        attempt > 0,
      );
    });
    translated.push(...toTranslatedSegments(transcript, items));
    onProgress?.(index + 1, chunks.length, [...translated], false);
  }

  return translated;
}
