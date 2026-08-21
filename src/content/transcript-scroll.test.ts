import { describe, expect, it } from "vitest";
import {
  getTranscriptLazyLoadDirection,
  getTranscriptTargetScrollTop,
} from "./transcript-scroll";

const baseState = {
  deltaY: 100,
  scrollTop: 0,
  clientHeight: 500,
  scrollHeight: 500,
  loadedStart: 0,
  loadedEnd: 2,
  totalChunks: 6,
};

describe("transcript wheel lazy loading", () => {
  it("loads the next chunk when visible content is too short to scroll", () => {
    expect(getTranscriptLazyLoadDirection(baseState)).toBe("after");
  });

  it("loads the next chunk when a scrollable reader reaches the bottom", () => {
    expect(getTranscriptLazyLoadDirection({
      ...baseState,
      scrollTop: 300,
      clientHeight: 500,
      scrollHeight: 800,
    })).toBe("after");
  });

  it("does not load while scrolling inside the current range", () => {
    expect(getTranscriptLazyLoadDirection({
      ...baseState,
      scrollTop: 100,
      clientHeight: 500,
      scrollHeight: 800,
    })).toBeNull();
  });

  it("loads an earlier chunk when scrolling up at the top", () => {
    expect(getTranscriptLazyLoadDirection({
      ...baseState,
      deltaY: -100,
      loadedStart: 2,
    })).toBe("before");
  });

  it("does not load beyond either transcript boundary", () => {
    expect(getTranscriptLazyLoadDirection({
      ...baseState,
      loadedEnd: 5,
    })).toBeNull();
    expect(getTranscriptLazyLoadDirection({
      ...baseState,
      deltaY: -100,
    })).toBeNull();
  });
});

describe("transcript playback-position scrolling", () => {
  it("converts viewport geometry into the container scroll coordinate space", () => {
    expect(getTranscriptTargetScrollTop({
      scrollTop: 120,
      clientHeight: 400,
      scrollHeight: 1_600,
      containerTop: 180,
      targetTop: 500,
      targetHeight: 500,
    })).toBe(428);
  });

  it("centers a short section so it remains the active scroll-spy section", () => {
    expect(getTranscriptTargetScrollTop({
      scrollTop: 0,
      clientHeight: 500,
      scrollHeight: 1_500,
      containerTop: 200,
      targetTop: 700,
      targetHeight: 200,
    })).toBe(350);
  });

  it("clamps the target position at both transcript boundaries", () => {
    expect(getTranscriptTargetScrollTop({
      scrollTop: 0,
      clientHeight: 500,
      scrollHeight: 1_500,
      containerTop: 200,
      targetTop: 210,
      targetHeight: 100,
    })).toBe(0);
    expect(getTranscriptTargetScrollTop({
      scrollTop: 900,
      clientHeight: 500,
      scrollHeight: 1_500,
      containerTop: 200,
      targetTop: 900,
      targetHeight: 100,
    })).toBe(1_000);
  });
});
