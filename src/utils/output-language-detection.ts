import type { OutputLanguage } from "./i18n";

export type OutputLanguageStatus = "match" | "mismatch" | "uncertain";

export interface OutputLanguageDetection {
  status: OutputLanguageStatus;
  isReliable: boolean;
  detectedLanguage?: string;
  percentage?: number;
  languages: chrome.i18n.DetectedLanguage[];
}

function languageFamily(languageCode: string): string {
  return languageCode.trim().toLowerCase().replaceAll("_", "-").split("-")[0];
}

/**
 * Detect the generated summary language with Chrome's built-in CLD-backed API.
 * Chinese variants intentionally share the `zh` family here; script validation
 * can be added separately without changing this control flow.
 */
export async function detectOutputLanguage(
  text: string,
  targetLanguage: OutputLanguage,
): Promise<OutputLanguageDetection> {
  if (
    !text.trim() ||
    typeof chrome === "undefined" ||
    !chrome.i18n?.detectLanguage
  ) {
    return { status: "uncertain", isReliable: false, languages: [] };
  }

  try {
    const result = await chrome.i18n.detectLanguage(text);
    const languages = [...result.languages].sort((a, b) => b.percentage - a.percentage);
    const primary = languages[0];

    if (!result.isReliable || !primary?.language) {
      return {
        status: "uncertain",
        isReliable: result.isReliable,
        detectedLanguage: primary?.language,
        percentage: primary?.percentage,
        languages,
      };
    }

    return {
      status: languageFamily(primary.language) === languageFamily(targetLanguage)
        ? "match"
        : "mismatch",
      isReliable: true,
      detectedLanguage: primary.language,
      percentage: primary.percentage,
      languages,
    };
  } catch {
    // Language detection must never prevent an otherwise valid summary.
    return { status: "uncertain", isReliable: false, languages: [] };
  }
}
