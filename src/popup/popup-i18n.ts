import {
  UI_LANGUAGES,
  type UiLanguage,
} from "../utils/i18n";

interface MessagePlaceholder {
  content: string;
}

interface MessageEntry {
  message: string;
  placeholders?: Record<string, MessagePlaceholder>;
}

export type MessageCatalog = Record<string, MessageEntry>;
export type PopupTranslator = (key: string, substitutions?: string | string[]) => string;

const catalogCache = new Map<UiLanguage, Promise<MessageCatalog>>();

function substitutionList(substitutions?: string | string[]): string[] {
  if (substitutions === undefined) return [];
  return Array.isArray(substitutions) ? substitutions : [substitutions];
}

function lookupCaseInsensitive<T>(record: Record<string, T>, key: string): T | undefined {
  const normalizedKey = key.toLowerCase();
  const entry = Object.entries(record).find(([candidate]) => candidate.toLowerCase() === normalizedKey);
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

export function createPopupTranslator(
  primaryCatalog: MessageCatalog,
  englishCatalog: MessageCatalog,
  chromeFallback: PopupTranslator,
): PopupTranslator {
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

export async function loadPopupTranslator(
  language: UiLanguage,
  chromeFallback: PopupTranslator,
): Promise<PopupTranslator> {
  if (language === "en") {
    const catalog = await loadCatalog(language);
    return createPopupTranslator(catalog, catalog, chromeFallback);
  }
  const [primaryCatalog, englishCatalog] = await Promise.all([
    loadCatalog(language),
    loadCatalog("en"),
  ]);
  return createPopupTranslator(primaryCatalog, englishCatalog, chromeFallback);
}
