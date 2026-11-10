import { describe, expect, it } from "vitest";
import { captionPrefetchLeadSeconds, getOverlayPrefetchChunk } from "./caption-prefetch";

const segments = [0, 60, 120, 180].map((start) => ({ start, duration: 60, text: "Caption." }));
const chunks = segments.map((_, index) => ({ id: index, targetStart: index, targetEnd: index, contextStart: 0, contextEnd: 3 }));

describe("playback caption prefetch", () => {
  it("starts the following block thirty real seconds before it is needed", () => {
    const translated = () => true;
    const onlyCurrent = (chunk: typeof chunks[0]) => chunk.id === 0;
    expect(getOverlayPrefetchChunk(segments, chunks, 0, 29, onlyCurrent)).toBeUndefined();
    expect(getOverlayPrefetchChunk(segments, chunks, 0, 30, onlyCurrent)).toBe(chunks[1]);
    expect(getOverlayPrefetchChunk(segments, chunks, 0, 31, translated)).toBeUndefined();
  });
  it("prioritizes the current missing block after seeking, without translating skipped blocks", () => {
    expect(getOverlayPrefetchChunk(segments, chunks, 2, 135, () => false)).toBe(chunks[2]);
  });
  it("accounts for speed changes and recent request time, including repairs", () => {
    expect(captionPrefetchLeadSeconds(2)).toBe(60);
    expect(captionPrefetchLeadSeconds(.5)).toBe(15);
    expect(captionPrefetchLeadSeconds(1, [40_000])).toBe(55);
    expect(captionPrefetchLeadSeconds(2, [40_000])).toBe(110);
    expect(captionPrefetchLeadSeconds(1, [200_000])).toBe(90);
    expect(captionPrefetchLeadSeconds(NaN, [NaN, -1])).toBe(30);
    expect(captionPrefetchLeadSeconds(1, [200_000, 1000, 1000, 1000])).toBe(30);
    expect(getOverlayPrefetchChunk(segments, chunks, 0, 10, (chunk) => chunk.id === 0, 2)).toBe(chunks[1]);
  });
  it("does not recursively prefetch the whole video, even with a slow model and short chunks", () => {
    expect(getOverlayPrefetchChunk(segments, chunks, 0, 55, (chunk) => chunk.id <= 1, 2, [120_000])).toBeUndefined();
    expect(getOverlayPrefetchChunk(segments, chunks, 1, 65, (chunk) => chunk.id <= 1, 2, [120_000])).toBe(chunks[2]);
  });
  it("uses the following start as its deadline when original cue display lifetimes overlap", () => {
    const overlapping = [{ ...segments[0], duration: 1000 }, ...segments.slice(1)];
    expect(getOverlayPrefetchChunk(overlapping, chunks, 0, 35, (chunk) => chunk.id === 0)).toBe(chunks[1]);
  });
  it("does not prefetch across a long silence prematurely and stops at the final block", () => {
    const gapped = segments.map((cue) => ({ ...cue, start: cue.start * 10 }));
    expect(getOverlayPrefetchChunk(gapped, chunks, 0, 35, (chunk) => chunk.id === 0)).toBeUndefined();
    expect(getOverlayPrefetchChunk(segments, chunks, 3, 200, () => true)).toBeUndefined();
    expect(getOverlayPrefetchChunk([], [], 0, 0, () => false)).toBeUndefined();
  });
});
