export const OUTPUT_LANGUAGES = [
  { code: "zh-CN", nativeName: "简体中文", englishName: "Simplified Chinese" },
  { code: "zh-TW", nativeName: "繁體中文", englishName: "Traditional Chinese" },
  { code: "en", nativeName: "English", englishName: "English" },
  { code: "ja", nativeName: "日本語", englishName: "Japanese" },
  { code: "ko", nativeName: "한국어", englishName: "Korean" },
  { code: "es", nativeName: "Español", englishName: "Spanish" },
  { code: "fr", nativeName: "Français", englishName: "French" },
  { code: "de", nativeName: "Deutsch", englishName: "German" },
] as const;

export type OutputLanguage = (typeof OUTPUT_LANGUAGES)[number]["code"];

export function isOutputLanguage(value: unknown): value is OutputLanguage {
  return OUTPUT_LANGUAGES.some((language) => language.code === value);
}

export function t(key: string, substitutions?: string | string[]): string {
  if (typeof chrome === "undefined" || !chrome.i18n?.getMessage) return key;
  return chrome.i18n.getMessage(key, substitutions) || key;
}

export function getUiLocale(): string {
  if (typeof chrome === "undefined" || !chrome.i18n?.getUILanguage) return "zh-CN";
  return chrome.i18n.getUILanguage() || "zh-CN";
}

export function outputLanguageFromLocale(locale: string): OutputLanguage {
  const normalized = locale.trim().toLowerCase().replaceAll("_", "-");
  if (/^zh-(tw|hk|mo|hant)(?:-|$)/.test(normalized)) return "zh-TW";
  if (/^zh(?:-|$)/.test(normalized)) return "zh-CN";
  for (const code of ["en", "ja", "ko", "es", "fr", "de"] as const) {
    if (normalized === code || normalized.startsWith(`${code}-`)) return code;
  }
  return "zh-CN";
}

export function getInitialOutputLanguage(): OutputLanguage {
  return outputLanguageFromLocale(getUiLocale());
}

export function getOutputLanguageInfo(code: OutputLanguage) {
  return OUTPUT_LANGUAGES.find((language) => language.code === code)!;
}
