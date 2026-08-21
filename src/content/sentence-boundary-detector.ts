import initSentenceX, {
  get_sentence_boundaries as getSentenceXBoundaries,
} from "sentencex-wasm";
import sentenceXWasmUrl from "sentencex-wasm/sentencex_wasm_bg.wasm?url";

export type SentenceBoundarySource = "sentencex" | "intl-segmenter";

export interface SentenceBoundaryHint {
  /** UTF-16 offset in the input text, suitable for String#slice. */
  offset: number;
  source: SentenceBoundarySource;
}

interface SentenceXBoundary {
  end_index?: unknown;
  text?: unknown;
}

let sentenceXInitialization: Promise<unknown> | null = null;

function normalizedLanguageCode(languageCode: string): string {
  const normalized = languageCode.trim().replaceAll("_", "-");
  if (!normalized || normalized === "unknown") return "en";
  return normalized.split("-")[0].toLowerCase();
}

function canonicalOffset(text: string, rawOffset: number): number {
  let offset = Math.max(0, Math.min(text.length, rawOffset));
  while (offset < text.length && /\s/u.test(text[offset])) offset += 1;
  return offset;
}

function initializeSentenceX(): Promise<unknown> {
  const packagedUrl = typeof chrome !== "undefined" && chrome.runtime?.getURL
    ? chrome.runtime.getURL(sentenceXWasmUrl.replace(/^\//u, ""))
    : sentenceXWasmUrl;
  sentenceXInitialization ??= initSentenceX({ module_or_path: packagedUrl });
  return sentenceXInitialization;
}

function sentenceXHints(text: string, rawBoundaries: unknown): SentenceBoundaryHint[] {
  if (!Array.isArray(rawBoundaries)) return [];
  const hints: SentenceBoundaryHint[] = [];
  let reconstructedOffset = 0;

  for (const rawBoundary of rawBoundaries) {
    const boundary = rawBoundary && typeof rawBoundary === "object"
      ? rawBoundary as SentenceXBoundary
      : {};
    // SentenceX also exposes byte/code-point offsets. Accumulating its non-destructive
    // boundary text is the reliable way to obtain JavaScript UTF-16 offsets (emoji use
    // two UTF-16 code units).
    if (typeof boundary.text === "string") {
      reconstructedOffset += boundary.text.length;
    } else if (typeof boundary.end_index === "number" && Number.isInteger(boundary.end_index)) {
      reconstructedOffset = boundary.end_index;
    } else {
      continue;
    }
    const offset = canonicalOffset(text, reconstructedOffset);
    if (offset > 0 && offset < text.length && hints.at(-1)?.offset !== offset) {
      hints.push({ offset, source: "sentencex" });
    }
  }
  return hints;
}

function intlSegmenterHints(languageCode: string, text: string): SentenceBoundaryHint[] {
  try {
    const locale = languageCode && languageCode !== "unknown"
      ? languageCode.replaceAll("_", "-")
      : undefined;
    const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
    const hints: SentenceBoundaryHint[] = [];
    for (const sentence of segmenter.segment(text)) {
      const offset = canonicalOffset(text, sentence.index + sentence.segment.length);
      if (offset > 0 && offset < text.length && hints.at(-1)?.offset !== offset) {
        hints.push({ offset, source: "intl-segmenter" });
      }
    }
    return hints;
  } catch {
    return [];
  }
}

/**
 * Return conservative sentence-boundary hints without ever making caption loading fail.
 * SentenceX is packaged with the extension; Intl.Segmenter remains a zero-cost fallback
 * for test runners and browsers where WebAssembly initialization is unavailable.
 */
export async function detectSentenceBoundaries(
  languageCode: string,
  text: string,
): Promise<SentenceBoundaryHint[]> {
  if (!text.trim()) return [];
  try {
    await initializeSentenceX();
    return sentenceXHints(
      text,
      getSentenceXBoundaries(normalizedLanguageCode(languageCode), text),
    );
  } catch {
    return intlSegmenterHints(languageCode, text);
  }
}
