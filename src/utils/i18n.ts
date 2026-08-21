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

export const UI_LANGUAGES = [
  { code: "zh-CN", catalog: "zh_CN", nativeName: "简体中文" },
  { code: "zh-TW", catalog: "zh_TW", nativeName: "繁體中文" },
  { code: "en", catalog: "en", nativeName: "English" },
  { code: "ja", catalog: "ja", nativeName: "日本語" },
  { code: "ko", catalog: "ko", nativeName: "한국어" },
] as const;

export type OutputLanguage = (typeof OUTPUT_LANGUAGES)[number]["code"];
export type UiLanguage = (typeof UI_LANGUAGES)[number]["code"];

interface MessagePlaceholder {
  content: string;
}

interface MessageEntry {
  message: string;
  placeholders?: Record<string, MessagePlaceholder>;
}

export type MessageCatalog = Record<string, MessageEntry>;
export type UiTranslator = (key: string, substitutions?: string | string[]) => string;

const catalogCache = new Map<UiLanguage, Promise<MessageCatalog>>();
let activationVersion = 0;

const chromeTranslator: UiTranslator = (key, substitutions) => {
  if (typeof chrome === "undefined" || !chrome.i18n?.getMessage) return "";
  return chrome.i18n.getMessage(key, substitutions);
};

let activeTranslator: UiTranslator = (key, substitutions) =>
  chromeTranslator(key, substitutions) || key;

export function isOutputLanguage(value: unknown): value is OutputLanguage {
  return OUTPUT_LANGUAGES.some((language) => language.code === value);
}

export function isUiLanguage(value: unknown): value is UiLanguage {
  return UI_LANGUAGES.some((language) => language.code === value);
}

function substitutionList(substitutions?: string | string[]): string[] {
  if (substitutions === undefined) return [];
  return Array.isArray(substitutions) ? substitutions : [substitutions];
}

function lookupCaseInsensitive<T>(record: Record<string, T>, key: string): T | undefined {
  const normalizedKey = key.toLowerCase();
  const entry = Object.entries(record).find(
    ([candidate]) => candidate.toLowerCase() === normalizedKey,
  );
  return entry?.[1];
}

export function formatCatalogMessage(
  catalog: MessageCatalog,
  key: string,
  substitutions?: string | string[],
): string {
  const entry = lookupCaseInsensitive(catalog, key);
  if (!entry || typeof entry.message !== "string") return "";

  const values = substitutionList(substitutions);
  const replacePositional = (text: string): string => text.replace(
    /\$(\d)/gu,
    (match, index: string) => values[Number(index) - 1] ?? match,
  );
  const withNamedPlaceholders = entry.message.replace(
    /\$([a-z0-9_]+)\$/giu,
    (match, placeholderName: string) => {
      const placeholder = entry.placeholders
        ? lookupCaseInsensitive(entry.placeholders, placeholderName)
        : undefined;
      return placeholder ? replacePositional(placeholder.content) : match;
    },
  );
  return replacePositional(withNamedPlaceholders);
}

export function createUiTranslator(
  primaryCatalog: MessageCatalog,
  englishCatalog: MessageCatalog,
  chromeFallback: UiTranslator = chromeTranslator,
): UiTranslator {
  return (key, substitutions) =>
    formatCatalogMessage(primaryCatalog, key, substitutions) ||
    formatCatalogMessage(englishCatalog, key, substitutions) ||
    chromeFallback(key, substitutions) ||
    key;
}

async function loadCatalog(language: UiLanguage): Promise<MessageCatalog> {
  const cached = catalogCache.get(language);
  if (cached) return cached;
  const info = UI_LANGUAGES.find((candidate) => candidate.code === language)!;
  const url = chrome.runtime.getURL(`_locales/${info.catalog}/messages.json`);
  const request = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load UI catalog: ${response.status}`);
    return await response.json() as MessageCatalog;
  })();
  catalogCache.set(language, request);
  try {
    return await request;
  } catch (error) {
    catalogCache.delete(language);
    throw error;
  }
}

export async function loadUiTranslator(
  language: UiLanguage,
  chromeFallback: UiTranslator = chromeTranslator,
): Promise<UiTranslator> {
  if (language === "en") {
    const catalog = await loadCatalog(language);
    return createUiTranslator(catalog, catalog, chromeFallback);
  }
  const [primaryCatalog, englishCatalog] = await Promise.all([
    loadCatalog(language),
    loadCatalog("en"),
  ]);
  return createUiTranslator(primaryCatalog, englishCatalog, chromeFallback);
}

/** Activate a fixed UI language in the current extension execution context. */
export async function activateUiLanguage(language: UiLanguage): Promise<boolean> {
  const requestVersion = ++activationVersion;
  const translator = await loadUiTranslator(language);
  if (requestVersion !== activationVersion) return false;
  activeTranslator = translator;
  return true;
}

export function t(key: string, substitutions?: string | string[]): string {
  return activeTranslator(key, substitutions);
}

export function getUiLocale(): string {
  if (typeof chrome === "undefined" || !chrome.i18n?.getUILanguage) return "zh-CN";
  return chrome.i18n.getUILanguage() || "zh-CN";
}

export function uiLanguageFromLocale(locale: string): UiLanguage {
  const normalized = locale.trim().toLowerCase().replaceAll("_", "-");
  if (/^zh-(tw|hk|mo|hant)(?:-|$)/.test(normalized)) return "zh-TW";
  if (/^zh(?:-|$)/.test(normalized)) return "zh-CN";
  for (const code of ["en", "ja", "ko"] as const) {
    if (normalized === code || normalized.startsWith(`${code}-`)) return code;
  }
  return "en";
}

export function getInitialUiLanguage(): UiLanguage {
  return uiLanguageFromLocale(getUiLocale());
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
