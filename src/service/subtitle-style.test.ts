import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_STYLE_PRESETS,
  normalizeSubtitleStyle,
} from "./subtitle-style";

describe("subtitle style settings", () => {
  it("uses the classic style for missing or malformed settings", () => {
    expect(normalizeSubtitleStyle(undefined)).toEqual(DEFAULT_SUBTITLE_STYLE);
    expect(normalizeSubtitleStyle([])).toEqual(DEFAULT_SUBTITLE_STYLE);
  });

  it("uses the selected preset for omitted fields", () => {
    expect(normalizeSubtitleStyle({ preset: "cinema" })).toEqual(
      SUBTITLE_STYLE_PRESETS.cinema,
    );
  });

  it("preserves a valid custom style and canonicalizes colors", () => {
    expect(normalizeSubtitleStyle({
      preset: "custom",
      sourceFontScale: 85,
      translationFontScale: 125,
      sourceColor: "#aabbcc",
      translationColor: "#123456",
      backgroundColor: "#101010",
      backgroundOpacity: 42,
      bottomOffset: 20,
    })).toEqual({
      preset: "custom",
      sourceFontScale: 85,
      translationFontScale: 125,
      sourceColor: "#AABBCC",
      translationColor: "#123456",
      backgroundColor: "#101010",
      backgroundOpacity: 42,
      bottomOffset: 20,
    });
  });

  it("clamps and rounds numeric fields", () => {
    expect(normalizeSubtitleStyle({
      sourceFontScale: 60,
      translationFontScale: 200,
      backgroundOpacity: 42.6,
      bottomOffset: 100,
    })).toMatchObject({
      sourceFontScale: 75,
      translationFontScale: 150,
      backgroundOpacity: 43,
      bottomOffset: 35,
    });
  });

  it("falls back invalid fields independently", () => {
    expect(normalizeSubtitleStyle({
      preset: "minimal",
      sourceFontScale: Number.NaN,
      translationFontScale: 120,
      sourceColor: "red",
      translationColor: "#00ff00",
      backgroundColor: "#123",
    })).toMatchObject({
      preset: "minimal",
      sourceFontScale: SUBTITLE_STYLE_PRESETS.minimal.sourceFontScale,
      translationFontScale: 120,
      sourceColor: SUBTITLE_STYLE_PRESETS.minimal.sourceColor,
      translationColor: "#00FF00",
      backgroundColor: SUBTITLE_STYLE_PRESETS.minimal.backgroundColor,
    });
  });
});
