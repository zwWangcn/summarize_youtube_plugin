import type { Transcript, TranscriptSegment } from "./transcript";

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LETTER = /[\p{L}\p{M}\p{N}'’]/u;

// Recognize only music labels, not arbitrary bracketed speech / names / technical terms.
const MUSIC_LABEL = /\[\s*(?:music(?:\s+playing)?|音乐|音樂|音楽|음악)\s*\]/giu;

/** Remove labels and normalize whitespace while retaining a source-character map. */
function cleanSourceCue(cue: TranscriptSegment): TranscriptSegment {
  const removed = Array<boolean>(cue.text.length).fill(false);
  const deletions = new Map<number, number>();
  for (const match of cue.text.matchAll(MUSIC_LABEL)) {
    const start = match.index!;
    const end = start + match[0].length;
    deletions.set(start, end);
    removed.fill(true, start, end);
  }
  let filtered = "";
  const origins: number[] = [];
  for (let index = 0; index < cue.text.length;) {
    const end = deletions.get(index);
    if (end !== undefined) {
      filtered += " "; origins.push(-1); index = end;
    } else {
      filtered += cue.text[index]; origins.push(index++);
    }
  }
  let text = "";
  const positions = Array<number>(cue.text.length).fill(-1);
  let lineStart = 0;
  for (const line of filtered.split("\n")) {
    let firstWord = true;
    for (const match of line.matchAll(/\S+/gu)) {
      if (text) text += firstWord ? "\n" : " ";
      for (let local = 0; local < match[0].length; local++) {
        const origin = origins[lineStart + match.index! + local];
        if (origin >= 0) positions[origin] = text.length;
        text += match[0][local];
      }
      firstWord = false;
    }
    lineStart += line.length + 1;
  }
  if (text === cue.text) return cue;
  const nextKept = Array<number>(cue.text.length + 1).fill(cue.text.length);
  const previousKept = Array<number>(cue.text.length).fill(-1);
  for (let i = cue.text.length - 1; i >= 0; i--) nextKept[i] = positions[i] >= 0 ? i : nextKept[i + 1];
  for (let i = 0; i < cue.text.length; i++) previousKept[i] = positions[i] >= 0 ? i : (previousKept[i - 1] ?? -1);
  const validOffset = (offset: number) => Number.isInteger(offset) && offset >= 0 && offset < cue.text.length;
  return { ...cue, text,
    timingMarkers: cue.timingMarkers?.flatMap((marker) => {
      if (!validOffset(marker.offset) || removed[marker.offset]) return [];
      const next = nextKept[marker.offset];
      return next < cue.text.length ? [{ ...marker, offset: positions[next] }] : [];
    }),
    timingRuns: cue.timingRuns?.flatMap((run) => {
      if (!validOffset(run.offset) || !Number.isInteger(run.endOffset) || run.endOffset <= run.offset || run.endOffset > cue.text.length) return [];
      const first = nextKept[run.offset];
      const last = previousKept[run.endOffset - 1];
      if (first > last) return [];
      // A removed music onset is not a speech onset for words later in that run.
      const start = removed[run.offset] ? undefined : run.start;
      return [{ offset: positions[first], endOffset: positions[last] + 1, ...(start === undefined ? {} : { start }) }];
    }),
  };
}

/** Cheap, model-free preparation shared by source view, summaries and translation. */
export function prepareCaptionSource(transcript: Transcript): Transcript {
  return { ...transcript, segments: transcript.segments.flatMap((cue, index) => {
    if (!Number.isFinite(cue.start) || cue.start < 0 || !Number.isFinite(cue.duration) || cue.duration < 0) return [];
    const cleaned = cleanSourceCue(cue);
    if (!cleaned.text) return [];
    return [{ ...cleaned, sourceStartId: cue.sourceStartId ?? index,
      sourceEndId: cue.sourceEndId ?? index }];
  }) };
}

export interface SourceSpan {
  cue: TranscriptSegment;
  index: number;
  from: number;
  to: number;
}

export interface CaptionSourceWindow {
  text: string;
  spans: SourceSpan[];
  /** Only observed onsets / event starts, never proportional estimates. */
  boundaries: Map<number, number>;
}

function wordBoundary(text: string, offset: number): boolean {
  // A UTF-16 marker cannot split a surrogate pair, even if its timestamp is valid.
  const previous = text.charCodeAt(offset - 1);
  const next = text.charCodeAt(offset);
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) return false;
  const left = [...text.slice(0, offset)].at(-1) ?? "";
  const right = text.slice(offset)[0] ?? "";
  return !(LETTER.test(left) && LETTER.test(right) && !CJK.test(left) && !CJK.test(right));
}

export function buildCaptionSourceWindow(
  transcript: Transcript, start = 0, end = transcript.segments.length - 1,
): CaptionSourceWindow {
  let text = "";
  const spans: SourceSpan[] = [];
  const boundaries = new Map<number, number>();
  for (let index = start; index <= end; index++) {
    const cue = transcript.segments[index];
    if (!cue) continue;
    if (text && !(CJK.test(text.at(-1) ?? "") && CJK.test(cue.text[0] ?? "")) &&
      !/^[,.;:!?，。；：！？、）)】」』]/u.test(cue.text)) text += " ";
    const from = text.length;
    text += cue.text;
    spans.push({ cue, index, from, to: text.length });
    boundaries.set(from, cue.start);
    for (const marker of cue.timingMarkers ?? []) {
      if (!Number.isInteger(marker.offset) || marker.offset < 0 || marker.offset >= cue.text.length ||
        !Number.isFinite(marker.start) || marker.start < cue.start ||
        marker.start > cue.start + cue.duration) continue;
      let offset = from + marker.offset;
      while (offset < text.length && /\s/u.test(text[offset])) offset++;
      if (offset < text.length && wordBoundary(text, offset)) boundaries.set(offset, marker.start);
    }
  }
  // A cue edge can join two fragments of a word; never expose that as an internal cut.
  for (const offset of boundaries.keys()) {
    if (!wordBoundary(text, offset)) boundaries.delete(offset);
  }
  return { text, spans, boundaries };
}

export function normalizeSourceWhitespace(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}

export class SourceCoverageError extends Error {
  constructor(message: string) { super(message); this.name = "SourceCoverageError"; }
}

/** Comparison only. The displayed source and timestamps always use original coordinates. */
function comparisonText(text: string) {
  let normalized = "";
  const originalStarts: number[] = [];
  const originalEnds: number[] = [];
  const append = (value: string, from: number, to: number) => {
    normalized += value;
    for (let i = 0; i < value.length; i++) { originalStarts.push(from); originalEnds.push(to); }
  };
  const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  // Grapheme coordinates also cover decomposed accents, surrogate pairs and Hangul Jamo.
  for (const token of text.matchAll(/\s+|\S+/gu)) {
    const from = token.index!;
    const to = from + token[0].length;
    if (/^\s/u.test(token[0])) {
      // Optional CJK spacing is not a Latin word separator. All Latin separators stay mandatory.
      const left = [...text.slice(Math.max(0, from - 2), from)].at(-1) ?? "";
      const right = [...text.slice(to, to + 2)][0] ?? "";
      if (CJK.test(left) || CJK.test(right)) continue;
      append(" ", from, to);
    } else {
      for (const { segment, index } of graphemes.segment(token[0])) {
        const value = segment.normalize("NFC").replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"');
        append(value, from + index, from + index + segment.length);
      }
    }
  }
  return { normalized, originalStarts, originalEnds };
}

/** Consume the current prefix only; never search ahead or fuzzy-match missing/reordered words.
 * Allow canonical Unicode and quotation styles, but preserve case, numbers and punctuation.
 */
export function locateSourceParts(window: CaptionSourceWindow, parts: string[]): Array<[number, number]> {
  const { normalized, originalStarts, originalEnds } = comparisonText(window.text);
  let cursor = 0;
  const ranges: Array<[number, number]> = [];
  for (const part of parts) {
    while (normalized[cursor] === " ") cursor++;
    const excerpt = comparisonText(part).normalized.trim();
    if (!excerpt || !normalized.startsWith(excerpt, cursor)) {
      throw new SourceCoverageError(`Source excerpts must exactly and continuously cover TARGET; never rewrite or skip text. At source offset ${originalStarts[cursor] ?? window.text.length}, expected ${JSON.stringify(normalized.slice(cursor, cursor + 60))}, received ${JSON.stringify(excerpt.slice(0, 60))}. Whitespace may vary; words and punctuation must match.`);
    }
    const from = originalStarts[cursor];
    cursor += excerpt.length;
    // A cut must not land inside a grapheme that normalized to several UTF-16 code units.
    if (cursor < originalStarts.length && originalStarts[cursor] === originalStarts[cursor - 1]) {
      throw new SourceCoverageError("Source excerpts cannot split a Unicode grapheme.");
    }
    ranges.push([from, originalEnds[cursor - 1]]);
  }
  while (normalized[cursor] === " ") cursor++;
  if (!ranges.length || cursor !== normalized.length) throw new SourceCoverageError("Source excerpts do not cover all TARGET text.");
  return ranges;
}

/** Include original timing as well as text: identical words with new timing are a new source. */
export async function fingerprintCaptionSource(transcript: Transcript): Promise<string> {
  const data = JSON.stringify(transcript);
  const bytes = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
