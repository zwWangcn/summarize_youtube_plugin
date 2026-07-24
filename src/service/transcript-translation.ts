import { streamAIText } from "./ai";
import type { Transcript, TranscriptSegment } from "../content/transcript";

// 12k chars keeps Japanese/other dense scripts plus JSON safely below the
// smallest configured providers' 16k output-token ceiling.
const TARGET_CHARS_PER_CHUNK = 12_000;
const CONTEXT_SEGMENTS = 4;
const MAX_FORMAT_ATTEMPTS = 2;

export interface TranslatedSegment {
  start: number;
  duration: number;
  text: string;
}

interface TranslationChunk {
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

const TRANSLATION_SYSTEM_PROMPT = `你是一名严谨的字幕校对与翻译专家。你的任务是把字幕翻译成简体中文，同时修复自动字幕的错误切分。

严格规则：
1. 合并被错误切碎的连续片段，按完整语义重新分段。
2. 只修正结合上下文可以高度确定的语音识别错误；不确定时忠实翻译原文，不猜测、不补写。
3. 保留人名、产品名、技术术语等专有名词，必要时使用“原文（中文释义）”。
4. 不总结、不省略、不扩写，不添加解释或评论。
5. 只覆盖 TARGET 范围内的字幕；CONTEXT 仅用于理解边界。
6. 输出 NDJSON（每行一个独立 JSON 对象），不要输出 JSON 数组、Markdown 或说明文字。每行必须是：
{"sourceStartId":整数,"sourceEndId":整数,"translatedText":"简体中文"}
7. TARGET 中每个 ID 必须按顺序恰好覆盖一次；可以合并相邻 ID，但不能跳过、重叠或改变顺序。`;

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
    : "（无）";
  const target = segmentLines(transcript.segments, chunk.targetStart, chunk.targetEnd);
  const after = chunk.targetEnd < chunk.contextEnd
    ? segmentLines(transcript.segments, chunk.targetEnd + 1, chunk.contextEnd)
    : "（无）";
  const retry = previousInvalidOutput
    ? `\n上一次输出未通过格式或覆盖校验。请重新输出，不要解释。上一次输出：\n${previousInvalidOutput.slice(0, 4000)}\n`
    : "";

  return `源字幕语言代码：${transcript.languageCode}
TARGET ID 范围：${chunk.targetStart}-${chunk.targetEnd}

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
    throw new TranslationFormatError("AI 未返回 JSON 数组");
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new TranslationFormatError("AI 返回的 JSON 无法解析");
  }
}

export function validateTranslationOutput(
  raw: string,
  targetStart: number,
  targetEnd: number,
): ModelTranslation[] {
  const parsed = extractJsonArray(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new TranslationFormatError("AI 返回了空翻译");
  }

  const result: ModelTranslation[] = parsed.map((item) => {
    const value = item as Partial<ModelTranslation>;
    if (
      !Number.isInteger(value.sourceStartId) ||
      !Number.isInteger(value.sourceEndId) ||
      typeof value.translatedText !== "string" ||
      !value.translatedText.trim()
    ) {
      throw new TranslationFormatError("AI 返回项缺少合法字段");
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
      throw new TranslationFormatError("AI 返回的字幕 ID 存在遗漏、重叠或乱序");
    }
    expected = item.sourceEndId + 1;
  }
  if (expected !== targetEnd + 1) {
    throw new TranslationFormatError("AI 返回的字幕 ID 未完整覆盖目标范围");
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
    throw new TranslationFormatError("AI 返回了无法解析的字幕行");
  }
  const value = parsed as Partial<ModelTranslation>;
  if (
    !Number.isInteger(value.sourceStartId) ||
    !Number.isInteger(value.sourceEndId) ||
    typeof value.translatedText !== "string" ||
    !value.translatedText.trim()
  ) {
    throw new TranslationFormatError("AI 返回的字幕行缺少合法字段");
  }
  if (
    value.sourceStartId !== expectedStart ||
    value.sourceEndId! < value.sourceStartId! ||
    value.sourceEndId! > targetEnd
  ) {
    throw new TranslationFormatError("AI 返回的字幕 ID 存在遗漏、重叠或越界");
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
  onPartial?: (items: ModelTranslation[], attempt: number) => void,
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
        TRANSLATION_SYSTEM_PROMPT,
        buildUserPrompt(transcript, chunk, attempt > 0 ? previousOutput : undefined),
        {
          maxOutputTokens: 16384,
          temperature: 0.1,
          disableThinking: true,
          firstResponseTimeoutMs: 30_000,
          inactivityTimeoutMs: 45_000,
          maxRetries: 1,
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
        throw new TranslationFormatError("AI 返回的字幕未完整覆盖目标范围");
      }
      return items;
    } catch (error) {
      if (!(error instanceof TranslationFormatError)) throw error;
      lastError = error as Error;
      previousOutput = rawOutput;
    }
  }

  throw lastError ?? new TranslationFormatError("字幕翻译格式校验失败");
}

export async function translateTranscript(
  transcript: Transcript,
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
    const toTranslatedSegments = (items: ModelTranslation[]): TranslatedSegment[] => items.map((item) => {
      const first = transcript.segments[item.sourceStartId];
      const last = transcript.segments[item.sourceEndId];
      const end = last.start + last.duration;
      return {
        start: first.start,
        duration: Math.max(0, end - first.start),
        text: item.translatedText,
      };
    });
    const items = await translateChunk(transcript, chunk, (partialItems, attempt) => {
      onProgress?.(
        index,
        chunks.length,
        [...translated, ...toTranslatedSegments(partialItems)],
        attempt > 0,
      );
    });
    translated.push(...toTranslatedSegments(items));
    onProgress?.(index + 1, chunks.length, [...translated], false);
  }

  return translated;
}
