import { describe, expect, it } from "vitest";
import { getAdjacentPopupTab, isPopupTabId } from "./popup-tabs";

describe("popup tab navigation", () => {
  it("recognizes supported tabs", () => {
    expect(isPopupTabId("general")).toBe(true);
    expect(isPopupTabId("subtitles")).toBe(true);
    expect(isPopupTabId("controls")).toBe(true);
    expect(isPopupTabId("settings")).toBe(false);
  });

  it("moves and wraps with horizontal arrow keys", () => {
    expect(getAdjacentPopupTab("general", "ArrowRight")).toBe("subtitles");
    expect(getAdjacentPopupTab("subtitles", "ArrowRight")).toBe("controls");
    expect(getAdjacentPopupTab("controls", "ArrowRight")).toBe("ai");
    expect(getAdjacentPopupTab("ai", "ArrowRight")).toBe("general");
    expect(getAdjacentPopupTab("general", "ArrowLeft")).toBe("ai");
  });

  it("supports Home and End without handling unrelated keys", () => {
    expect(getAdjacentPopupTab("subtitles", "Home")).toBe("general");
    expect(getAdjacentPopupTab("subtitles", "End")).toBe("ai");
    expect(getAdjacentPopupTab("subtitles", "Enter")).toBeNull();
  });
});
