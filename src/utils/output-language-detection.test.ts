import { afterEach, describe, expect, it, vi } from "vitest";
import { detectOutputLanguage } from "./output-language-detection";

function mockDetection(result: chrome.i18n.LanguageDetectionResult): void {
  vi.stubGlobal("chrome", {
    i18n: {
      detectLanguage: vi.fn(async () => result),
    },
  });
}

describe("summary output language detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("matches the requested language family", async () => {
    mockDetection({
      isReliable: true,
      languages: [{ language: "en-US", percentage: 97 }],
    });

    await expect(detectOutputLanguage("English summary", "en")).resolves.toMatchObject({
      status: "match",
      detectedLanguage: "en-US",
      percentage: 97,
    });
  });

  it("treats a reliable different language as a mismatch", async () => {
    mockDetection({
      isReliable: true,
      languages: [
        { language: "ja", percentage: 88 },
        { language: "zh", percentage: 12 },
      ],
    });

    await expect(detectOutputLanguage("日本語の要約", "zh-CN")).resolves.toMatchObject({
      status: "mismatch",
      detectedLanguage: "ja",
    });
  });

  it.each(["zh-CN", "zh-TW"] as const)(
    "maps %s to the Chinese language family",
    async (targetLanguage) => {
      mockDetection({
        isReliable: true,
        languages: [{ language: "zh", percentage: 99 }],
      });

      await expect(detectOutputLanguage("中文总结", targetLanguage)).resolves.toMatchObject({
        status: "match",
      });
    },
  );

  it("does not classify an unreliable result as a mismatch", async () => {
    mockDetection({
      isReliable: false,
      languages: [{ language: "ja", percentage: 51 }],
    });

    await expect(detectOutputLanguage("mixed content", "zh-CN")).resolves.toMatchObject({
      status: "uncertain",
      detectedLanguage: "ja",
    });
  });

  it("falls back to uncertain when Chrome detection fails", async () => {
    vi.stubGlobal("chrome", {
      i18n: {
        detectLanguage: vi.fn(async () => { throw new Error("unavailable"); }),
      },
    });

    await expect(detectOutputLanguage("summary", "en")).resolves.toEqual({
      status: "uncertain",
      isReliable: false,
      languages: [],
    });
  });
});
