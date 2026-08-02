import { describe, expect, it } from "vitest";
import {
  OUTPUT_LANGUAGES,
  outputLanguageFromLocale,
} from "./i18n";

describe("output language locale mapping", () => {
  it.each([
    ["zh-CN", "zh-CN"],
    ["zh_Hans", "zh-CN"],
    ["zh-TW", "zh-TW"],
    ["zh-Hant-HK", "zh-TW"],
    ["en-US", "en"],
    ["ja-JP", "ja"],
    ["ko-KR", "ko"],
    ["es-419", "es"],
    ["fr-FR", "fr"],
    ["de-DE", "de"],
  ] as const)("maps %s to %s", (locale, expected) => {
    expect(outputLanguageFromLocale(locale)).toBe(expected);
  });

  it("falls back unsupported locales to Simplified Chinese", () => {
    expect(outputLanguageFromLocale("pt-BR")).toBe("zh-CN");
  });

  it("keeps output language codes unique", () => {
    const codes = OUTPUT_LANGUAGES.map((language) => language.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
