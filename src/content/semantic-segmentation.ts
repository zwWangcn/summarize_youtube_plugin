import type {
  Transcript,
  TranscriptSegment,
  TranscriptSplitReason,
  TranscriptTimingMarker,
} from "./transcript";
import {
  detectSentenceBoundaries,
  type SentenceBoundaryHint,
} from "./sentence-boundary-detector";

const STRONG_PAUSE_SECONDS = 0.6;
const MEDIUM_PAUSE_SECONDS = 0.25;
const PREFERRED_SEGMENT_WIDTH = 110;
const PREFERRED_SEGMENT_SECONDS = 10;
const HARD_SEGMENT_WIDTH = 200;
const HARD_SEGMENT_SECONDS = 18;
const MIN_SEGMENT_WIDTH = 24;
const MIN_SEGMENT_SECONDS = 0.8;
const CUT_COST = 2.5;
const MAX_PREDECESSORS = 140;

const TERMINAL_PUNCTUATION_RE = /[.!?。！？…‥][.!?。！？…‥]*["'”’）)\]}】」』]*$/u;
const AMBIGUOUS_PERIOD_RE = /\.(?:["'”’）)\]}】」』]*)$/u;
const WEAK_PUNCTUATION_RE = /[,;:，；：、]["'”’）)\]}】」』]*$/u;
const SPEAKER_MARKER_RE = /^(?:>>|[-–—]\s+|[^\n:]{1,24}:\s)/u;
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LEADING_PUNCTUATION_RE = /^[,.;:!?，。；：！？、…‥）)\]}】」』]/u;
const WORD_END_RE = /[\p{L}\p{N}'’]+$/u;
const COMMON_ABBREVIATIONS = new Set([
  "a.m", "dr", "e.g", "etc", "fig", "i.e", "jr", "mr", "mrs", "ms", "no", "p.m",
  "prof", "sr", "st", "u.s", "vs",
]);
const ENGLISH_FORBIDDEN_WORDS = new Set([
  "a", "about", "across", "after", "among", "an", "and", "around", "as", "at",
  "because", "before", "between", "but", "by", "during", "every", "for", "from", "he", "i",
  "if", "in", "into", "it", "nor", "of", "on", "onto", "or", "over", "she", "so", "some",
  "than", "that", "the", "these", "they", "this", "those", "through", "to", "under", "we",
  "when", "which", "while", "who", "with", "within", "without", "yet", "you",
]);
const CJK_FORBIDDEN_END_RE = /(?:[的地得把被给和与及或而但因若在向从于对将]|から|まで|より|ので|のに|なら|そして|しかし|また|は|が|を|に|へ|と|で|の|も|て)$/u;
const KOREAN_FORBIDDEN_END_RE = /(?:은|는|이|가|을|를|에|에서|와|과|의|로|으로|그리고|하지만)$/u;
const ENGLISH_AUXILIARY_ENDINGS = new Set([
  "am", "are", "be", "been", "being", "can", "could", "did", "do", "does",
  "had", "has", "have", "is", "may", "might", "must", "shall", "should",
  "was", "were", "will", "would",
]);
const ENGLISH_GERUND_COMPLEMENT_VERBS = new Set([
  "avoid", "begin", "consider", "continue", "finish", "keep", "start", "stop",
]);
const ENGLISH_RELATIVE_HEADS = new Set(["place", "reason", "thing", "things", "time", "way"]);
const ENGLISH_CLAUSE_START_RE = /^(?:(?:although|because|but|if|so|then|though|unless|when|whereas|while|who|which)\b|(?:i|you|he|she|it|we|they|this|that|there|here)(?:['’](?:d|ll|m|re|s|ve)|\s+(?:am|are|can|could|did|do|does|had|has|have|is|may|might|must|shall|should|was|were|will|would)\b))/iu;
const SOUND_LABEL_PATTERN = "\\[(?:music(?:\\s+playing)?|applause|laughter|laughing|cheering|booing|音乐|音樂|掌声|笑声|笑聲|音楽|拍手|笑い|음악|박수|웃음)\\]";
const SOUND_LABEL_RE = new RegExp(SOUND_LABEL_PATTERN, "giu");
const SOUND_LABEL_ONLY_RE = new RegExp(
  `^\\s*(?:${SOUND_LABEL_PATTERN})(?:\\s*(?:${SOUND_LABEL_PATTERN}))*\\s*$`,
  "iu",
);

interface SourceCue extends TranscriptSegment {
  sourceStartId: number;
  sourceEndId: number;
  textStart: number;
  textEnd: number;
  end: number;
}

interface CandidateSignals {
  modelSource?: SentenceBoundaryHint["source"];
  terminalPunctuation: boolean;
  weakPunctuation: boolean;
  pauseSeconds: number;
  speakerChange: boolean;
  clauseBoundary: boolean;
  awkwardBoundary: boolean;
  soundLabelBoundary: boolean;
  forbiddenEnding: boolean;
  insideQuote: boolean;
  insideStructuralDelimiter: boolean;
  fallbackBoundary: boolean;
}

interface SplitCandidate {
  offset: number;
  leftEnd: number;
  rightStart: number;
  leftCueIndex: number;
  rightCueIndex: number;
  signals: CandidateSignals;
  score: number;
  reason: TranscriptSplitReason;
}

interface CandidateSeed {
  offset: number;
  modelSource?: SentenceBoundaryHint["source"];
  fallbackBoundary?: boolean;
  soundLabelBoundary?: boolean;
}

function normalizedText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("\n");
}

function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += CJK_RE.test(char) ? 2 : 1;
  return width;
}

function displayWidthPrefix(text: string): number[] {
  const prefix = Array<number>(text.length + 1).fill(0);
  for (let offset = 0; offset < text.length;) {
    const codePoint = text.codePointAt(offset)!;
    const char = String.fromCodePoint(codePoint);
    const nextOffset = offset + char.length;
    const nextWidth = prefix[offset] + (CJK_RE.test(char) ? 2 : 1);
    for (let index = offset + 1; index <= nextOffset; index += 1) {
      prefix[index] = nextWidth;
    }
    offset = nextOffset;
  }
  return prefix;
}

function separatorBetween(left: string, right: string): string {
  if (!left || !right || left.endsWith("\n") || right.startsWith("\n")) return "";
  const last = left.at(-1) ?? "";
  const first = right[0] ?? "";
  return !LEADING_PUNCTUATION_RE.test(right) && !(CJK_RE.test(last) && CJK_RE.test(first))
    ? " "
    : "";
}

function sourceSegmentEnd(segment: TranscriptSegment, next?: TranscriptSegment): number {
  if (segment.duration > 0) return segment.start + segment.duration;
  if (next && next.start > segment.start) return Math.min(next.start, segment.start + 2);
  return segment.start + 2;
}

function flattenTranscript(transcript: Transcript): { text: string; cues: SourceCue[] } {
  const source = transcript.segments
    .map((segment, sourceId) => ({
      ...segment,
      text: normalizedText(segment.text),
      sourceStartId: segment.sourceStartId ?? sourceId,
      sourceEndId: segment.sourceEndId ?? sourceId,
    }))
    .filter((segment) => segment.text);
  const cues: SourceCue[] = [];
  let text = "";

  for (const [index, segment] of source.entries()) {
    if (index > 0) text += separatorBetween(text, segment.text);
    const textStart = text.length;
    text += segment.text;
    cues.push({
      ...segment,
      textStart,
      textEnd: text.length,
      end: sourceSegmentEnd(segment, source[index + 1]),
    });
  }
  return { text, cues };
}

function canonicalOffset(text: string, rawOffset: number): number {
  let offset = Math.max(0, Math.min(text.length, rawOffset));
  while (offset < text.length && /\s/u.test(text[offset])) offset += 1;
  return offset;
}

function addSeed(seeds: Map<number, CandidateSeed>, text: string, seed: CandidateSeed): void {
  const offset = canonicalOffset(text, seed.offset);
  if (offset <= 0 || offset >= text.length) return;
  const existing = seeds.get(offset);
  seeds.set(offset, {
    offset,
    modelSource: existing?.modelSource === "sentencex" || seed.modelSource === "sentencex"
      ? "sentencex"
      : existing?.modelSource ?? seed.modelSource,
    fallbackBoundary: existing?.fallbackBoundary || seed.fallbackBoundary,
    soundLabelBoundary: existing?.soundLabelBoundary || seed.soundLabelBoundary,
  });
}

function soundLabelSeeds(text: string, seeds: Map<number, CandidateSeed>): void {
  for (const match of text.matchAll(SOUND_LABEL_RE)) {
    const start = match.index ?? 0;
    addSeed(seeds, text, { offset: start, soundLabelBoundary: true });
    addSeed(seeds, text, {
      offset: start + match[0].length,
      soundLabelBoundary: true,
    });
  }
}

function punctuationSeeds(text: string, seeds: Map<number, CandidateSeed>): void {
  const punctuation = /[.!?。！？…‥,;:，；：、]+["'”’）)\]}】」』]*/gu;
  for (const match of text.matchAll(punctuation)) {
    const matchIndex = match.index ?? 0;
    if (
      match[0] === "." &&
      /\d/u.test(text[matchIndex - 1] ?? "") &&
      /\d/u.test(text[matchIndex + 1] ?? "")
    ) continue;
    addSeed(seeds, text, { offset: matchIndex + match[0].length });
  }
}

function fallbackWordSeeds(text: string, seeds: Map<number, CandidateSeed>): void {
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    for (const word of segmenter.segment(text)) {
      if (!word.isWordLike) continue;
      let offset = word.index + word.segment.length;
      const trailingPunctuation = text.slice(offset).match(
        /^[.!?。！？…‥,;:，；：、]+["'”’）)\]}】」』]*/u,
      );
      if (trailingPunctuation) offset += trailingPunctuation[0].length;
      addSeed(seeds, text, {
        offset,
        fallbackBoundary: true,
      });
    }
    return;
  } catch {
    // The whitespace fallback below is enough to keep the pipeline functional.
  }
  for (const match of text.matchAll(/\s+/gu)) {
    addSeed(seeds, text, { offset: match.index ?? 0, fallbackBoundary: true });
  }
}

function exactMarkerTime(
  markers: TranscriptTimingMarker[] | undefined,
  localOffset: number,
): number | null {
  if (!markers?.length) return null;
  let nearest: TranscriptTimingMarker | undefined;
  for (const marker of markers) {
    if (!Number.isFinite(marker.start) || !Number.isInteger(marker.offset)) continue;
    if (!nearest || Math.abs(marker.offset - localOffset) < Math.abs(nearest.offset - localOffset)) {
      nearest = marker;
    }
  }
  return nearest && Math.abs(nearest.offset - localOffset) <= 3 ? nearest.start : null;
}

function estimatedTime(cue: SourceCue, localOffset: number): number {
  const markerTime = exactMarkerTime(cue.timingMarkers, localOffset);
  if (markerTime !== null) return Math.min(cue.end, Math.max(cue.start, markerTime));
  const totalWidth = Math.max(1, displayWidth(cue.text));
  const elapsedWidth = displayWidth(cue.text.slice(0, localOffset));
  return cue.start + (cue.end - cue.start) * (elapsedWidth / totalWidth);
}

function containingCueIndex(cues: SourceCue[], offset: number): number {
  let low = 0;
  let high = cues.length - 1;
  let result = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (cues[middle].textStart <= offset) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function boundaryTiming(cues: SourceCue[], offset: number): Pick<
  SplitCandidate,
  "leftEnd" | "rightStart" | "leftCueIndex" | "rightCueIndex"
> {
  const cueIndex = containingCueIndex(cues, offset);
  if (cueIndex > 0 && cues[cueIndex].textStart === offset) {
    const leftCueIndex = cueIndex - 1;
    return {
      leftEnd: cues[leftCueIndex].end,
      rightStart: cues[cueIndex].start,
      leftCueIndex,
      rightCueIndex: cueIndex,
    };
  }

  const cue = cues[cueIndex];
  const time = estimatedTime(cue, Math.max(0, Math.min(cue.text.length, offset - cue.textStart)));
  return {
    leftEnd: time,
    rightStart: time,
    leftCueIndex: cueIndex,
    rightCueIndex: cueIndex,
  };
}

function hasForbiddenEnding(textBefore: string, languageCode: string): boolean {
  const trimmed = textBefore.trimEnd().replace(/[,;:，；：、]+$/u, "");
  const language = languageCode.toLowerCase().split(/[-_]/u)[0];
  if (language === "zh" || language === "ja") return CJK_FORBIDDEN_END_RE.test(trimmed);
  if (language === "ko") return KOREAN_FORBIDDEN_END_RE.test(trimmed);
  const word = trimmed.match(WORD_END_RE)?.[0].toLowerCase();
  return Boolean(word && ENGLISH_FORBIDDEN_WORDS.has(word));
}

function looksLikeAbbreviation(textBefore: string): boolean {
  const token = textBefore.match(/([\p{L}][\p{L}.]*)\.["'”’）)\]}】」』]*$/u)?.[1] ?? "";
  const normalized = token.toLowerCase().replace(/^\.+|\.+$/gu, "");
  return COMMON_ABBREVIATIONS.has(normalized) ||
    /^[A-Z]$/u.test(token) ||
    /^(?:[A-Z]\.)+[A-Z]$/u.test(token);
}

function edgeWord(text: string, fromEnd: boolean): string {
  const match = fromEnd
    ? text.trimEnd().match(/[\p{L}\p{N}'’]+$/u)
    : text.trimStart().match(/^[\p{L}\p{N}'’]+/u);
  return match?.[0].toLowerCase() ?? "";
}

function looksLikeClauseBoundary(
  textBefore: string,
  textAfter: string,
  languageCode: string,
): boolean {
  if (languageCode.toLowerCase().split(/[-_]/u)[0] !== "en") return false;
  const after = textAfter.trimStart();
  if (ENGLISH_CLAUSE_START_RE.test(after)) return true;
  return WEAK_PUNCTUATION_RE.test(textBefore) && /^(?:a|an|the|this|that|these|those)\b/iu.test(after);
}

function looksLikeAwkwardBoundary(
  textBefore: string,
  textAfter: string,
  languageCode: string,
): boolean {
  if (hasForbiddenEnding(textBefore, languageCode)) return true;
  if (languageCode.toLowerCase().split(/[-_]/u)[0] !== "en") return false;
  const leftWord = edgeWord(textBefore.replace(/[,;:]+$/u, ""), true);
  const rightWord = edgeWord(textAfter, false);
  if (!leftWord || !rightWord) return false;
  if (ENGLISH_AUXILIARY_ENDINGS.has(leftWord) || /(?:n't|['’](?:d|ll|m|re|s|ve))$/iu.test(leftWord)) {
    return true;
  }
  if (/^(?:a|an|every|some|the|this|that|these|those)$/iu.test(rightWord) && /(?:ed|ing)$/iu.test(leftWord)) {
    return true;
  }
  if (ENGLISH_RELATIVE_HEADS.has(leftWord) && /^(?:he|i|it|she|they|we|you)$/iu.test(rightWord)) {
    return true;
  }
  return ENGLISH_GERUND_COMPLEMENT_VERBS.has(leftWord) && /ing$/iu.test(rightWord);
}

interface DelimiterState {
  insideQuote: boolean;
  insideStructuralDelimiter: boolean;
}

function delimiterStateAtOffsets(text: string, offsets: number[]): Map<number, DelimiterState> {
  const result = new Map<number, DelimiterState>();
  const stack: string[] = [];
  const matching: Record<string, string> = {
    ")": "(", "]": "[", "}": "{", "）": "（", "】": "【", "」": "「",
    "』": "『", "”": "“", "’": "‘",
  };
  const opening = new Set(Object.values(matching));
  const quoteOpenings = new Set(["“", "‘"]);
  let asciiDoubleQuoteOpen = false;
  let cursor = 0;

  for (const offset of offsets) {
    while (cursor < offset) {
      const char = text[cursor];
      if (opening.has(char)) {
        stack.push(char);
      } else if (matching[char]) {
        const expected = matching[char];
        const lastMatch = stack.lastIndexOf(expected);
        if (lastMatch >= 0) stack.splice(lastMatch, 1);
      } else if (char === '"') {
        asciiDoubleQuoteOpen = !asciiDoubleQuoteOpen;
      }
      cursor += char.length;
    }
    result.set(offset, {
      insideQuote: asciiDoubleQuoteOpen || stack.some((char) => quoteOpenings.has(char)),
      insideStructuralDelimiter: stack.some((char) => !quoteOpenings.has(char)),
    });
  }
  return result;
}

function candidateScore(signals: CandidateSignals): number {
  const hasStrongSignal = signals.terminalPunctuation ||
    signals.pauseSeconds >= STRONG_PAUSE_SECONDS ||
    signals.modelSource === "sentencex" ||
    signals.soundLabelBoundary ||
    signals.speakerChange;
  let score = hasStrongSignal ? 0 : -CUT_COST;
  if (signals.terminalPunctuation) score += 5;
  if (signals.pauseSeconds >= STRONG_PAUSE_SECONDS) score += 3;
  else if (signals.pauseSeconds >= MEDIUM_PAUSE_SECONDS) score += 1.5;
  if (signals.modelSource === "sentencex") score += 2;
  else if (signals.modelSource === "intl-segmenter") score += 1;
  if (signals.weakPunctuation) score += 1;
  if (signals.speakerChange) score += 5;
  if (signals.soundLabelBoundary) score += 10;
  if (signals.clauseBoundary) score += 0.5;
  if (signals.forbiddenEnding && !signals.terminalPunctuation) score -= 5;
  if (signals.awkwardBoundary && !signals.terminalPunctuation && !signals.soundLabelBoundary) {
    score -= 8;
  }
  if (signals.insideQuote && !signals.terminalPunctuation && !signals.soundLabelBoundary) score -= 3;
  if (signals.insideStructuralDelimiter && !signals.soundLabelBoundary) score -= 8;
  return score;
}

function candidateReason(signals: CandidateSignals): TranscriptSplitReason {
  if (signals.soundLabelBoundary) return "sound-label";
  if (signals.speakerChange) return "speaker-change";
  if (signals.terminalPunctuation) return "terminal-punctuation";
  if (signals.pauseSeconds >= STRONG_PAUSE_SECONDS) return "long-pause";
  if (signals.modelSource) return "sentence-boundary-model";
  if (signals.clauseBoundary) return "clause-boundary";
  if (signals.weakPunctuation) return "weak-punctuation";
  return "forced-best-candidate";
}

function buildCandidates(
  languageCode: string,
  text: string,
  cues: SourceCue[],
  modelHints: SentenceBoundaryHint[],
): SplitCandidate[] {
  const seeds = new Map<number, CandidateSeed>();
  for (const hint of modelHints) {
    addSeed(seeds, text, { offset: hint.offset, modelSource: hint.source });
  }
  for (let index = 1; index < cues.length; index += 1) {
    addSeed(seeds, text, { offset: cues[index].textStart, fallbackBoundary: true });
  }
  punctuationSeeds(text, seeds);
  soundLabelSeeds(text, seeds);
  fallbackWordSeeds(text, seeds);

  const offsets = [...seeds.keys()].sort((a, b) => a - b);
  const delimiterStates = delimiterStateAtOffsets(text, offsets);
  const candidates: SplitCandidate[] = [{
    offset: 0,
    leftEnd: cues[0].start,
    rightStart: cues[0].start,
    leftCueIndex: 0,
    rightCueIndex: 0,
    signals: {
      terminalPunctuation: false,
      weakPunctuation: false,
      pauseSeconds: 0,
      speakerChange: false,
      clauseBoundary: false,
      awkwardBoundary: false,
      soundLabelBoundary: false,
      forbiddenEnding: false,
      insideQuote: false,
      insideStructuralDelimiter: false,
      fallbackBoundary: false,
    },
    score: 0,
    reason: "start-of-transcript",
  }];

  for (const offset of offsets) {
    const seed = seeds.get(offset)!;
    const timing = boundaryTiming(cues, offset);
    const textBefore = text.slice(Math.max(0, offset - 80), offset).trimEnd();
    const textAfter = text.slice(offset).trimStart();
    const delimiterState = delimiterStates.get(offset) ?? {
      insideQuote: false,
      insideStructuralDelimiter: false,
    };
    const terminalPunctuation = TERMINAL_PUNCTUATION_RE.test(textBefore);
    const ambiguousPeriod = terminalPunctuation && AMBIGUOUS_PERIOD_RE.test(textBefore);
    const pauseSeconds = timing.leftCueIndex !== timing.rightCueIndex
      ? Math.max(0, timing.rightStart - timing.leftEnd)
      : 0;
    const signals: CandidateSignals = {
      modelSource: seed.modelSource,
      terminalPunctuation,
      weakPunctuation: WEAK_PUNCTUATION_RE.test(textBefore),
      pauseSeconds,
      speakerChange: timing.leftCueIndex !== timing.rightCueIndex && SPEAKER_MARKER_RE.test(textAfter),
      clauseBoundary: looksLikeClauseBoundary(textBefore, textAfter, languageCode),
      awkwardBoundary: looksLikeAwkwardBoundary(textBefore, textAfter, languageCode),
      soundLabelBoundary: seed.soundLabelBoundary ?? false,
      forbiddenEnding: hasForbiddenEnding(textBefore, languageCode),
      ...delimiterState,
      fallbackBoundary: seed.fallbackBoundary ?? false,
    };
    let score = candidateScore(signals);
    // A bare period rejected by the conservative boundary detector is commonly an
    // abbreviation or initial. Keep it as an emergency candidate, but do not reward it.
    if (
      ambiguousPeriod &&
      signals.modelSource !== "sentencex" &&
      looksLikeAbbreviation(textBefore)
    ) score -= 6;
    candidates.push({
      offset,
      ...timing,
      signals,
      score,
      reason: candidateReason(signals),
    });
  }

  const lastCueIndex = cues.length - 1;
  candidates.push({
    offset: text.length,
    leftEnd: cues[lastCueIndex].end,
    rightStart: cues[lastCueIndex].end,
    leftCueIndex: lastCueIndex,
    rightCueIndex: lastCueIndex,
    signals: {
      terminalPunctuation: false,
      weakPunctuation: false,
      pauseSeconds: 0,
      speakerChange: false,
      clauseBoundary: false,
      awkwardBoundary: false,
      soundLabelBoundary: false,
      forbiddenEnding: false,
      insideQuote: false,
      insideStructuralDelimiter: false,
      fallbackBoundary: false,
    },
    score: 0,
    reason: "end-of-transcript",
  });
  return candidates;
}

function segmentPenalty(
  widthPrefix: number[],
  left: SplitCandidate,
  right: SplitCandidate,
): number {
  const width = widthPrefix[right.offset] - widthPrefix[left.offset];
  const duration = Math.max(0, right.leftEnd - left.rightStart);
  if (width > HARD_SEGMENT_WIDTH || duration > HARD_SEGMENT_SECONDS) {
    return Number.POSITIVE_INFINITY;
  }
  const shortPenaltyFactor = left.score > 0 || right.score > 0 ? 0.5 : 1;
  let penalty = 0;

  if (width < MIN_SEGMENT_WIDTH) {
    penalty += ((MIN_SEGMENT_WIDTH - width) / MIN_SEGMENT_WIDTH) * 3 * shortPenaltyFactor;
  }
  if (duration < MIN_SEGMENT_SECONDS) {
    penalty += ((MIN_SEGMENT_SECONDS - duration) / MIN_SEGMENT_SECONDS) * 1.5 * shortPenaltyFactor;
  }
  if (width > PREFERRED_SEGMENT_WIDTH) {
    penalty += ((width - PREFERRED_SEGMENT_WIDTH) / 24) ** 2;
  }
  if (duration > PREFERRED_SEGMENT_SECONDS) {
    penalty += ((duration - PREFERRED_SEGMENT_SECONDS) / 3) ** 2;
  }
  return penalty;
}

function selectBestPath(text: string, candidates: SplitCandidate[]): number[] {
  const widthPrefix = displayWidthPrefix(text);
  const scores = Array<number>(candidates.length).fill(Number.NEGATIVE_INFINITY);
  const previous = Array<number>(candidates.length).fill(-1);
  scores[0] = 0;

  for (let rightIndex = 1; rightIndex < candidates.length; rightIndex += 1) {
    const isFinalCandidate = rightIndex === candidates.length - 1;
    if (!isFinalCandidate && !Number.isFinite(candidates[rightIndex].score)) continue;
    const firstPredecessor = Math.max(0, rightIndex - MAX_PREDECESSORS);
    const predecessorIndexes: number[] = [];
    for (let index = firstPredecessor; index < rightIndex; index += 1) {
      predecessorIndexes.push(index);
    }
    if (firstPredecessor > 0) {
      let earlierReachable = firstPredecessor - 1;
      while (earlierReachable > 0 && !Number.isFinite(scores[earlierReachable])) {
        earlierReachable -= 1;
      }
      predecessorIndexes.unshift(earlierReachable);
      if (earlierReachable !== 0) predecessorIndexes.unshift(0);
    }

    for (const leftIndex of predecessorIndexes) {
      if (!Number.isFinite(scores[leftIndex])) continue;
      const right = candidates[rightIndex];
      const cutReward = isFinalCandidate ? 0 : right.score;
      const score = scores[leftIndex] + cutReward - segmentPenalty(
        widthPrefix,
        candidates[leftIndex],
        right,
      );
      if (score > scores[rightIndex]) {
        scores[rightIndex] = score;
        previous[rightIndex] = leftIndex;
      }
    }
  }

  const path: number[] = [];
  let cursor = candidates.length - 1;
  while (cursor >= 0) {
    path.push(cursor);
    if (cursor === 0) break;
    cursor = previous[cursor];
    if (cursor < 0) return [0, candidates.length - 1];
  }
  return path.reverse();
}

function roundedDuration(start: number, end: number): number {
  return Math.max(0.1, Math.round((Math.max(start, end) - start) * 1000) / 1000);
}

/**
 * Construct semantic translation units while mapping every selected boundary back to
 * immutable YouTube timing. Candidate generation and global selection are intentionally
 * independent from playback lookup/rendering.
 */
export async function segmentTranscriptSemantically(
  transcript: Transcript,
): Promise<Transcript> {
  const { text, cues } = flattenTranscript(transcript);
  if (!text || !cues.length) return { ...transcript, segments: [] };

  const modelHints = await detectSentenceBoundaries(transcript.languageCode, text);
  const candidates = buildCandidates(transcript.languageCode, text, cues, modelHints);
  const path = selectBestPath(text, candidates);
  const segments: TranscriptSegment[] = [];

  for (let index = 1; index < path.length; index += 1) {
    const left = candidates[path[index - 1]];
    const right = candidates[path[index]];
    const segmentText = normalizedText(text.slice(left.offset, right.offset));
    if (!segmentText || SOUND_LABEL_ONLY_RE.test(segmentText)) continue;
    const firstCue = cues[left.rightCueIndex];
    const lastCue = cues[right.leftCueIndex];
    segments.push({
      start: left.rightStart,
      duration: roundedDuration(left.rightStart, right.leftEnd),
      text: segmentText,
      sourceStartId: firstCue.sourceStartId,
      sourceEndId: lastCue.sourceEndId,
      splitReason: right.reason,
      splitScore: Math.round(right.score * 100) / 100,
    });
  }

  return { ...transcript, segments };
}
