import { describe, expect, it } from "vitest";
import { cleanDocumentTitle, selectPlayerResponseForVideo } from "./youtube";

describe("YouTube SPA player-response selection", () => {
  it("ignores a stale response from the previously watched video", () => {
    const oldResponse = { videoDetails: { videoId: "video-a", title: "Old" } };
    const currentResponse = { videoDetails: { videoId: "video-b", title: "Current" } };

    expect(selectPlayerResponseForVideo([oldResponse, currentResponse], "video-b"))
      .toBe(currentResponse);
    expect(selectPlayerResponseForVideo([oldResponse], "video-b")).toBeNull();
  });
});

describe("document title fallback", () => {
  it.each([
    ["(3) How Rockets Work - YouTube", "How Rockets Work"],
    ["(99+) How Rockets Work - YouTube", "How Rockets Work"],
    ["How Rockets Work - YouTube", "How Rockets Work"],
    ["(2019) Year in Review - YouTube", "(2019) Year in Review"],
  ])("cleans %s", (raw, expected) => {
    expect(cleanDocumentTitle(raw)).toBe(expected);
  });
});
