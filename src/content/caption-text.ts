import type { TranscriptTimingMarker, TranscriptTimingRun } from "./transcript";

/** Keep JSON3 parsing and semantic segmentation on the same text coordinates. */
export function normalizeCaptionText(text: string): string {
  return text.split("\n")
    .map((line) => line.trim().replace(/\s+/gu, " "))
    .filter(Boolean)
    .join("\n");
}

interface CaptionRun {
  text: string;
  start?: number;
}

interface TextRange {
  rawStart: number;
  rawEnd: number;
  offset: number;
}

/** Map runs by source positions, including repeated words and collapsed whitespace. */
export function normalizeCaptionRuns(runs: CaptionRun[]): {
  text: string;
  timingMarkers: TranscriptTimingMarker[];
  timingRuns: TranscriptTimingRun[];
} {
  const rawText = runs.map((run) => run.text).join("");
  const ranges: TextRange[] = [];
  let text = "";
  let lineStart = 0;
  for (const line of rawText.split("\n")) {
    let firstWord = true;
    for (const match of line.matchAll(/\S+/gu)) {
      if (text) text += firstWord ? "\n" : " ";
      const rawStart = lineStart + match.index!;
      ranges.push({ rawStart, rawEnd: rawStart + match[0].length, offset: text.length });
      text += match[0];
      firstWord = false;
    }
    lineStart += line.length + 1;
  }

  const timingMarkers: TranscriptTimingMarker[] = [];
  const timingRuns: TranscriptTimingRun[] = [];
  let rawStart = 0;
  let rangeIndex = 0;
  for (const run of runs) {
    const rawEnd = rawStart + run.text.length;
    while (rangeIndex < ranges.length && ranges[rangeIndex].rawEnd <= rawStart) rangeIndex += 1;
    const first = ranges[rangeIndex];
    if (rawEnd > rawStart && first && first.rawStart < rawEnd) {
      let lastIndex = rangeIndex;
      while (lastIndex + 1 < ranges.length && ranges[lastIndex + 1].rawStart < rawEnd) lastIndex += 1;
      const last = ranges[lastIndex];
      const offset = first.offset + Math.max(0, rawStart - first.rawStart);
      const endOffset = last.offset + Math.min(rawEnd, last.rawEnd) - last.rawStart;
      const start = run.start;
      const timed = start !== undefined && Number.isFinite(start) && start >= 0;
      timingRuns.push({ offset, endOffset, ...(timed ? { start } : {}) });
      if (timed) timingMarkers.push({ offset, start });
      rangeIndex = lastIndex;
    }
    rawStart = rawEnd;
  }
  return { text, timingMarkers, timingRuns };
}
