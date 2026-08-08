import { describe, expect, it } from "vitest";
import { analyzeTextScripts } from "./i18n-debug";

describe("i18n diagnostics", () => {
  it("counts language scripts without retaining the source text", () => {
    expect(analyzeTextScripts("中文かなカナ한글ABC")).toEqual({
      nonWhitespace: 11,
      han: 2,
      hiragana: 2,
      katakana: 2,
      hangul: 2,
      latin: 3,
    });
  });

  it("does not count whitespace", () => {
    expect(analyzeTextScripts(" \n\t")).toEqual({
      nonWhitespace: 0,
      han: 0,
      hiragana: 0,
      katakana: 0,
      hangul: 0,
      latin: 0,
    });
  });
});
