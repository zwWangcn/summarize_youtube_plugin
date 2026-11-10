import type { TranscriptSegment } from "./transcript";
import type { TranslationChunk } from "../service/transcript-translation";

/** Wall-clock budget, converted to video time at the current playback rate. */
export function captionPrefetchLeadSeconds(playbackRate = 1, recentTranslationMs: number[] = []): number {
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  const samples = recentTranslationMs.slice(-3).filter((ms) => Number.isFinite(ms) && ms > 0);
  const slowestSeconds = Math.max(0, ...samples) / 1000;
  const wallSeconds = Math.min(90, Math.max(30, slowestSeconds * 1.25 + 5));
  return wallSeconds * rate;
}

/** Prioritize missing current captions; speculate no further than the following block. */
export function getOverlayPrefetchChunk(
  segments: TranscriptSegment[], chunks: TranslationChunk[], current: number, time: number,
  isTranslated: (chunk: TranslationChunk) => boolean, playbackRate = 1, recentTranslationMs: number[] = [],
): TranslationChunk | undefined {
  const active = chunks[current];
  if (!active) return undefined;
  if (!isTranslated(active)) return active;
  const next = chunks[current + 1];
  if (!next || isTranslated(next)) return undefined;
  // Caption display lifetimes can overlap or include a long silence. The next block's
  // actual start is its deadline, regardless of when the previous event disappears.
  const deadline = segments[next.targetStart]?.start;
  if (deadline === undefined || deadline - time > captionPrefetchLeadSeconds(playbackRate, recentTranslationMs)) return undefined;
  return next;
}
