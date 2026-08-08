import { describe, expect, it } from "vitest";
import { OUTPUT_LANGUAGES } from "../utils/i18n";
import {
  buildSummaryUserPrompt,
  buildSummaryTranslationSystemPrompt,
  buildSummaryTranslationUserPrompt,
  buildTargetLanguageRules,
  getSystemPrompt,
} from "./prompts";
import { buildTranslationSystemPrompt } from "./transcript-translation";

describe("localized AI prompts", () => {
  it.each(OUTPUT_LANGUAGES)("builds an unambiguous $englishName summary prompt", (language) => {
    const prompt = getSystemPrompt(language.code);
    expect(prompt).toContain(`Target language: **${language.englishName}** (${language.code})`);
    expect(prompt).toContain(`Return the complete answer in ${language.englishName} only.`);
    expect(prompt).toContain("[MM:SS]");
    expect(prompt).toContain("Markdown");
    expect(prompt).not.toContain("总结使用**简体中文**");
  });

  it.each(OUTPUT_LANGUAGES)(
    "repeats the $englishName output language around the transcript",
    (language) => {
      const transcript = "[00:00] 日本語の字幕";
      const prompt = buildSummaryUserPrompt(transcript, language.code);
      const reminder =
        `Regardless of the transcript's language, write the complete summary in ${language.englishName} (${language.code}) only.`;

      expect(prompt.startsWith(reminder)).toBe(true);
      expect(prompt.endsWith(
        language.code === "zh-CN"
          ? `${reminder} Use Simplified Chinese characters, not Traditional Chinese.`
          : language.code === "zh-TW"
            ? `${reminder} Use Traditional Chinese characters, not Simplified Chinese.`
            : reminder,
      )).toBe(true);
      expect(prompt).toContain(`<<<START OF VIDEO TRANSCRIPT>>>\n${transcript}\n<<<END OF VIDEO TRANSCRIPT>>>`);
    },
  );

  it.each(OUTPUT_LANGUAGES)("builds a $englishName caption translation prompt", (language) => {
    const prompt = buildTranslationSystemPrompt(language.code);
    expect(prompt).toContain(`into ${language.englishName} (${language.code})`);
    expect(prompt).toContain("NDJSON");
    expect(prompt).toContain(`written in ${language.englishName}`);
  });

  it.each(OUTPUT_LANGUAGES)("builds a lossless $englishName summary repair prompt", (language) => {
    const systemPrompt = buildSummaryTranslationSystemPrompt(language.code);
    const summary = "## 見出し\n- [00:10] 内容";
    const userPrompt = buildSummaryTranslationUserPrompt(summary);

    expect(systemPrompt).toContain(`into ${language.englishName} (${language.code})`);
    expect(systemPrompt).toContain("Preserve all Markdown structure");
    expect(systemPrompt).toContain("Do not summarize, omit, expand");
    expect(userPrompt).toContain(`<<<START OF SUMMARY>>>\n${summary}\n<<<END OF SUMMARY>>>`);
  });

  it("adds explicit Simplified and Traditional Chinese script constraints", () => {
    expect(buildTargetLanguageRules("zh-CN")).toContain("Simplified Chinese characters");
    expect(buildTargetLanguageRules("zh-TW")).toContain("Traditional Chinese characters");
  });
});
