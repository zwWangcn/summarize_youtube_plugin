import { describe, expect, it } from "vitest";
import { OUTPUT_LANGUAGES } from "../utils/i18n";
import { buildTargetLanguageRules, getSystemPrompt } from "./prompts";
import { buildTranslationSystemPrompt } from "./transcript-translation";

describe("localized AI prompts", () => {
  it.each(OUTPUT_LANGUAGES)("builds an unambiguous $englishName summary prompt", (language) => {
    const prompt = getSystemPrompt("youtube", language.code);
    expect(prompt).toContain(`Target language: **${language.englishName}** (${language.code})`);
    expect(prompt).toContain(`Return the complete answer in ${language.englishName} only.`);
    expect(prompt).toContain("[MM:SS]");
    expect(prompt).toContain("Markdown");
    expect(prompt).not.toContain("总结使用**简体中文**");
  });

  it.each(OUTPUT_LANGUAGES)("builds a $englishName caption translation prompt", (language) => {
    const prompt = buildTranslationSystemPrompt(language.code);
    expect(prompt).toContain(`into ${language.englishName} (${language.code})`);
    expect(prompt).toContain("NDJSON");
    expect(prompt).toContain(`written in ${language.englishName}`);
  });

  it("adds explicit Simplified and Traditional Chinese script constraints", () => {
    expect(buildTargetLanguageRules("zh-CN")).toContain("Simplified Chinese characters");
    expect(buildTargetLanguageRules("zh-TW")).toContain("Traditional Chinese characters");
  });

  it("keeps the Bilibili prompt on its existing Chinese-only behavior", () => {
    const prompt = getSystemPrompt("bilibili", "de");
    expect(prompt).toContain("总结使用**简体中文**");
    expect(prompt).not.toContain("Target language: **German**");
  });
});
