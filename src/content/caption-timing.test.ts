import { describe, expect, it } from "vitest";
import { buildTimingGapEvidence } from "./caption-timing";
import type { TranscriptTimingRun } from "./transcript";

function cue(words: string[], durations: number[], missing?: number) {
  let offset = 0;
  let start = 10;
  const timingRuns: TranscriptTimingRun[] = words.map((word, index) => {
    const run = { offset, endOffset: offset + word.length, ...(index === missing ? {} : { start }) };
    offset += word.length + 1;
    start += durations[index];
    return run;
  });
  return { text: words.join(" "), textStart: 0, start: 10, end: start, timingRuns };
}

describe("caption timing evidence", () => {
  it.each([0.2, 0.4])("adapts to local speech rate (%s seconds per word)", (duration) => {
    const source = cue(Array(24).fill("word"), Array(24).fill(duration));
    const evidence = buildTimingGapEvidence([source]);
    expect(evidence.size).toBeGreaterThan(0);
    expect([...evidence.values()].every(({ bonus }) => bonus === 0)).toBe(true);
  });

  it("rewards an outlying interval before the next word and caps the bonus at two", () => {
    const durations = Array(24).fill(0.2);
    durations[11] = 1;
    const source = cue(Array(24).fill("word"), durations);
    const gap = buildTimingGapEvidence([source]).get(source.timingRuns[12].offset)!;
    expect(gap.interval).toBeCloseTo(1);
    expect(gap.baseline).toBeCloseTo(0.2);
    expect(gap.bonus).toBeCloseTo(2);
    expect(buildTimingGapEvidence([source]).get(source.timingRuns[11].offset)?.bonus).toBe(0);
  });

  it("compares long words with long words rather than short-word intervals", () => {
    const words = Array.from({ length: 30 }, (_, index) => index % 2 ? "longword" : "word");
    const durations: number[] = words.map((word) => word.length === 8 ? 0.55 : 0.2);
    durations[15] = 0.68;
    const source = cue(words, durations);
    const gap = buildTimingGapEvidence([source]).get(source.timingRuns[16].offset)!;
    expect(gap.baseline).toBeCloseTo(0.55);
    expect(gap.bonus).toBe(0);
  });

  it("does not bridge an untimed word, use sparse markers, or reward a coarse span", () => {
    const source = cue(Array(24).fill("word"), Array(24).fill(0.2), 11);
    expect(buildTimingGapEvidence([source]).has(source.timingRuns[12].offset)).toBe(false);
    expect(buildTimingGapEvidence([{ ...source, timingRuns: undefined }]).size).toBe(0);
    const coarse = cue(Array(24).fill("several words"), Array(24).fill(1));
    expect(buildTimingGapEvidence([coarse]).size).toBe(0);
  });

  it("raises the outlier threshold when the surrounding cadence is irregular", () => {
    const durations = Array.from({ length: 24 }, (_, index) => [0.1, 0.45, 0.7][index % 3]);
    durations[11] = 0.9;
    const source = cue(Array(24).fill("word"), durations);
    const gap = buildTimingGapEvidence([source]).get(source.timingRuns[12].offset)!;
    expect(gap.threshold).toBeGreaterThan(0.15);
    expect(gap.bonus).toBe(0);
  });

  it("rejects duplicate, reversed, and out-of-cue timestamps", () => {
    const source = cue(Array(24).fill("word"), Array(24).fill(0.2));
    source.timingRuns[8].start = source.timingRuns[7].start;
    source.timingRuns[14].start = 9;
    source.timingRuns[19].start = source.end + 1;
    const evidence = buildTimingGapEvidence([source]);
    for (const index of [8, 9, 14, 15, 19, 20]) {
      expect(evidence.has(source.timingRuns[index].offset)).toBe(false);
    }
  });

  it("keeps working with short CJK runs and scales their confidence conservatively", () => {
    const durations = Array(24).fill(0.2);
    durations[11] = 1;
    const source = cue(Array(24).fill("字幕"), durations);
    const gap = buildTimingGapEvidence([source]).get(source.timingRuns[12].offset)!;
    expect(gap.bonus).toBeCloseTo(1.6);
  });

  it("uses absolute starts across overlapping source cues without consulting display ends", () => {
    const source = cue(Array(24).fill("word"), Array(24).fill(0.2));
    const split = 12;
    const shift = source.timingRuns[split].offset;
    const left = { ...source, text: source.text.slice(0, shift).trimEnd(),
      end: source.end + 10, timingRuns: source.timingRuns.slice(0, split) };
    const right = { ...source, text: source.text.slice(shift), textStart: shift,
      start: source.timingRuns[split].start! + 0.8,
      end: source.end + 0.8,
      timingRuns: source.timingRuns.slice(split).map((run) => ({
        ...run, offset: run.offset - shift, endOffset: run.endOffset - shift, start: run.start! + 0.8,
      })) };
    const gap = buildTimingGapEvidence([left, right]).get(shift)!;
    expect(gap.interval).toBeCloseTo(1);
    expect(gap.bonus).toBeCloseTo(2);
  });
});
