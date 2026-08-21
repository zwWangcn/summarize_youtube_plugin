import { describe, expect, it } from "vitest";
import { getBilingualOverlayVisibility } from "./bilingual-overlay";

const translatedCue = {
  sourceText: "Hello",
  translationText: "你好",
};

describe("bilingual overlay visibility", () => {
  it("shows both lines outside learning mode", () => {
    expect(getBilingualOverlayVisibility(translatedCue, {
      learningMode: false,
      translationOnly: false,
      hovered: false,
    })).toMatchObject({ showSource: true, showTranslation: true });
  });

  it("hides translation until hover in learning mode", () => {
    expect(getBilingualOverlayVisibility(translatedCue, {
      learningMode: true,
      translationOnly: false,
      hovered: false,
    })).toMatchObject({ showSource: true, showTranslation: false });
    expect(getBilingualOverlayVisibility(translatedCue, {
      learningMode: true,
      translationOnly: false,
      hovered: true,
    }).showTranslation).toBe(true);
  });

  it("shows only translation when translation-only overrides learning mode", () => {
    expect(getBilingualOverlayVisibility(translatedCue, {
      learningMode: true,
      translationOnly: true,
      hovered: false,
    })).toMatchObject({ showSource: false, showTranslation: true });
  });

  it("keeps source as a fallback when translation is unnecessary", () => {
    expect(getBilingualOverlayVisibility({ sourceText: "你好" }, {
      learningMode: true,
      translationOnly: true,
      hovered: false,
    })).toMatchObject({ showSource: true, showTranslation: false });
  });

  it("shows translation status without exposing source in translation-only mode", () => {
    expect(getBilingualOverlayVisibility({
      sourceText: "Hello",
      statusText: "Translating…",
    }, {
      learningMode: true,
      translationOnly: true,
      hovered: false,
    })).toMatchObject({ showSource: false, showStatus: true });
  });
});
