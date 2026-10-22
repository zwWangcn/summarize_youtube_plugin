import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_STYLE_PRESETS,
  SUBTITLE_POSITION_PRESETS,
  getSubtitlePositionPreset,
  getSubtitlePositionCssValues,
  getSubtitleContainerCssValues,
  getSubtitleTypographyCssValues,
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
      maxWidth: 100,
      bottomOffset: 20,
    })).toEqual({
      preset: "custom",
      sourceFontScale: 85,
      translationFontScale: 125,
      sourceColor: "#AABBCC",
      translationColor: "#123456",
      backgroundColor: "#101010",
      backgroundOpacity: 42,
      maxWidth: 100,
      bottomOffset: 20,
      positionX: 50,
      positionY: 80,
    });
  });

  it("clamps and rounds numeric fields", () => {
    expect(normalizeSubtitleStyle({
      sourceFontScale: 60,
      translationFontScale: 200,
      backgroundOpacity: 42.6,
      maxWidth: 120,
      bottomOffset: 100,
    })).toMatchObject({
      sourceFontScale: 75,
      translationFontScale: 150,
      backgroundOpacity: 43,
      maxWidth: 100,
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

  it("converts typography settings into responsive CSS values", () => {
    expect(getSubtitleTypographyCssValues({
      preset: "custom",
      sourceFontScale: 80,
      translationFontScale: 125,
      sourceColor: "#abcdef",
      translationColor: "#123456",
    })).toEqual({
      sourceFontSize: "clamp(12px, 1.32vw, 19.2px)",
      translationFontSize: "clamp(21.25px, 2.375vw, 35px)",
      sourceColor: "#ABCDEF",
      translationColor: "#123456",
    });
  });

  it("converts background sizing and opacity into CSS values", () => {
    expect(getSubtitleContainerCssValues({
      preset: "custom",
      backgroundColor: "#102030",
      backgroundOpacity: 55,
      maxWidth: 70,
    })).toEqual({
      background: "rgba(16, 32, 48, 0.55)",
      boxShadow: "0 2px 12px rgba(0, 0, 0, 0.16)",
      maxWidth: "70%",
    });
  });

  it("removes the background shadow at zero opacity", () => {
    expect(getSubtitleContainerCssValues({ backgroundOpacity: 0 }).boxShadow).toBe("none");
  });

  it("loads legacy vertical offsets and bounds new coordinates independently", () => {
    expect(normalizeSubtitleStyle({ bottomOffset: 20 })).toMatchObject({ positionX: 50, positionY: 80 });
    expect(normalizeSubtitleStyle({ positionX: -5, positionY: 120 })).toMatchObject({ positionX: 0, positionY: 100 });
    expect(normalizeSubtitleStyle({ positionX: 33.6, positionY: Number.NaN })).toMatchObject({ positionX: 34, positionY: 89 });
  });

  it("recognizes preset coordinates and marks freely adjusted positions as custom", () => {
    for (const [name, position] of Object.entries(SUBTITLE_POSITION_PRESETS)) {
      expect(getSubtitlePositionPreset(position)).toBe(name);
    }
    expect(getSubtitlePositionPreset({ positionX: 32, positionY: 63 })).toBe("custom");
  });

  it("positions both edges and the center within the available travel space", () => {
    for (const [x, y] of [[0, 0], [100, 100], [50, 50]]) {
      expect(getSubtitlePositionCssValues({ positionX: x, positionY: y })).toEqual({
        left: `${x}%`, top: `${y}%`, transform: `translate(${-x}%, ${-y}%)`,
      });
    }
  });
});
