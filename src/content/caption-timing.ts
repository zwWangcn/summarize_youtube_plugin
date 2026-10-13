import type { TranscriptTimingGap, TranscriptTimingRun } from "./transcript";

const REFERENCE_RADIUS = 10;
const MIN_REFERENCES = 4;
const FULL_CONFIDENCE_REFERENCES = 8;
const MAX_REFERENCE_DISTANCE_SECONDS = 8;
const MAD_TO_STANDARD_DEVIATION = 1.4826;
const MIN_EXCESS_SECONDS = 0.15;
const EXCESS_RAMP_SECONDS = 0.4;
const MAX_TIME_BONUS = 2;
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD_RE = /[\p{L}\p{N}]/u;

interface TimingCue {
  text: string;
  textStart: number;
  start: number;
  end: number;
  timingRuns?: TranscriptTimingRun[];
}

interface TimedUnit {
  offset: number;
  endOffset: number;
  start: number;
  length: number;
  kind: "cjk" | "other";
  confidence: number;
}

interface Interval {
  offset: number;
  interval: number;
  left: TimedUnit;
  chain: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Start-to-start intervals contain articulation as well as possible silence.
 * Reward only local outliers with comparable text spans; never infer word ends.
 * Sparse legacy timingMarkers remain usable for playback, but not pause scoring.
 */
export function buildTimingGapEvidence(cues: TimingCue[]): Map<number, TranscriptTimingGap> {
  const intervals: Interval[] = [];
  let previous: TimedUnit | undefined;
  let chain = 0;

  for (const cue of cues) {
    if (!cue.timingRuns?.length) {
      previous = undefined;
      continue;
    }
    for (const run of cue.timingRuns) {
      const validRange = Number.isInteger(run.offset) && Number.isInteger(run.endOffset) &&
        run.offset >= 0 && run.endOffset > run.offset && run.endOffset <= cue.text.length;
      if (!validRange) {
        previous = undefined;
        chain += 1;
        continue;
      }
      const span = cue.text.slice(run.offset, run.endOffset);
      if (!WORD_RE.test(span)) continue;
      if (run.start === undefined || !Number.isFinite(run.start) ||
        run.start < cue.start || run.start > cue.end) {
        // Untimed lexical text must not be skipped to manufacture a long interval.
        previous = undefined;
        continue;
      }
      const cjk = CJK_RE.test(span);
      const letters = [...span].filter((char) => WORD_RE.test(char)).length;
      const fineGrained = !/\s/u.test(span) && (cjk ? letters <= 8 : letters <= 24);
      const unit: TimedUnit = {
        offset: cue.textStart + run.offset,
        endOffset: cue.textStart + run.endOffset,
        start: run.start,
        length: letters,
        kind: cjk ? "cjk" : "other",
        confidence: fineGrained ? (cjk ? 0.8 : 1) : 0,
      };
      // A run split inside a word is not an independent word onset.
      if (!cjk && (
        WORD_RE.test(cue.text[run.offset - 1] ?? "") ||
        WORD_RE.test(cue.text[run.endOffset] ?? "")
      )) unit.confidence = 0;
      if (previous && (unit.start <= previous.start || unit.offset < previous.endOffset)) {
        previous = undefined;
        chain += 1;
        continue;
      }
      if (previous?.confidence) {
        intervals.push({ offset: unit.offset, interval: unit.start - previous.start, left: previous, chain });
      }
      previous = unit;
    }
  }

  const evidence = new Map<number, TranscriptTimingGap>();
  for (let index = 0; index < intervals.length; index += 1) {
    const current = intervals[index];
    const references: number[] = [];
    for (let otherIndex = Math.max(0, index - REFERENCE_RADIUS);
      otherIndex <= Math.min(intervals.length - 1, index + REFERENCE_RADIUS); otherIndex += 1) {
      if (otherIndex === index) continue;
      const other = intervals[otherIndex];
      if (other.chain !== current.chain || other.left.kind !== current.left.kind) continue;
      if (Math.abs(other.left.start - current.left.start) > MAX_REFERENCE_DISTANCE_SECONDS) continue;
      if (Math.abs(other.left.length - current.left.length) > Math.max(1, current.left.length * 0.35)) continue;
      references.push(other.interval);
    }
    if (references.length < MIN_REFERENCES) continue;
    const baseline = median(references);
    const deviation = MAD_TO_STANDARD_DEVIATION * median(references.map((value) => Math.abs(value - baseline)));
    const threshold = Math.max(MIN_EXCESS_SECONDS, 3 * deviation);
    const excess = Math.max(0, current.interval - baseline);
    const strength = Math.max(0, Math.min(1, (excess - threshold) / EXCESS_RAMP_SECONDS));
    const confidence = current.left.confidence * Math.min(1, references.length / FULL_CONFIDENCE_REFERENCES);
    evidence.set(current.offset, {
      interval: current.interval, baseline, threshold, strength, confidence,
      bonus: MAX_TIME_BONUS * confidence * strength,
    });
  }
  return evidence;
}
