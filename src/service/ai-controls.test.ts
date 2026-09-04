import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSLATION_CHUNK_PRESET,
  getTranslationChunkLimits,
  normalizeCustomPromptProfile,
  normalizeTranslationChunkPreset,
  truncateUnicode,
  unicodeLength,
} from "./ai-controls";

describe("AI control settings", () => {
  it("maps the three caption chunk presets to bounded time and character limits", () => {
    expect(getTranslationChunkLimits("fast")).toEqual({ maxSeconds: 30, maxChars: 2_000 });
    expect(getTranslationChunkLimits("balanced")).toEqual({ maxSeconds: 60, maxChars: 4_000 });
    expect(getTranslationChunkLimits("context")).toEqual({ maxSeconds: 120, maxChars: 8_000 });
    expect(normalizeTranslationChunkPreset("unbounded")).toBe(DEFAULT_TRANSLATION_CHUNK_PRESET);
  });

  it("counts and truncates Unicode code points without splitting emoji", () => {
    expect(unicodeLength("术语🎮表")).toBe(4);
    expect(truncateUnicode("术语🎮表", 3)).toBe("术语🎮");
  });

  it("normalizes valid prompt profiles and rejects oversized or malformed values", () => {
    expect(normalizeCustomPromptProfile({
      id: "game",
      name: " 游戏术语 ",
      instruction: " ADC 保留英文 ",
    })).toEqual({ id: "game", name: "游戏术语", instruction: "ADC 保留英文" });
    expect(normalizeCustomPromptProfile({
      id: "too-long",
      name: "name",
      instruction: "字".repeat(501),
    })).toBeNull();
    expect(normalizeCustomPromptProfile({ id: "empty", name: "", instruction: "text" }))
      .toBeNull();
  });
});
