import { describe, expect, it } from "vitest";
import { normalizeCaptionLanguage } from "./caption-language";

describe("preferred source-caption language", () => {
  it.each([
    ["ja", "ja"], ["ar", "ar"], [" PT_br ", "pt-BR"], ["zh_hant", "zh-Hant"],
    ["", "en"], [null, "en"], ["not a language", "en"], ["x".repeat(40), "en"],
  ])("normalizes %j to %s", (input, expected) => {
    expect(normalizeCaptionLanguage(input)).toBe(expected);
  });
});
