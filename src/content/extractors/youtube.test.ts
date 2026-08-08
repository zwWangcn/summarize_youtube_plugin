import { describe, expect, it } from "vitest";
import { selectPlayerResponseForVideo } from "./youtube";

describe("YouTube SPA player-response selection", () => {
  it("ignores a stale response from the previously watched video", () => {
    const oldResponse = { videoDetails: { videoId: "video-a", title: "Old" } };
    const currentResponse = { videoDetails: { videoId: "video-b", title: "Current" } };

    expect(selectPlayerResponseForVideo([oldResponse, currentResponse], "video-b"))
      .toBe(currentResponse);
    expect(selectPlayerResponseForVideo([oldResponse], "video-b")).toBeNull();
  });
});
