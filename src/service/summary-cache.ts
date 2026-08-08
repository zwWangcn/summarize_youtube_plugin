/** 总结缓存：每条总结使用独立 storage key，避免多标签页整表覆盖。 */

import type { OutputLanguage } from "../utils/i18n";

export interface CachedSummary {
  text: string;
  videoTitle: string;
  videoId: string;
  source: string;
  outputLanguage: OutputLanguage;
  timestamp: number;
}

const LEGACY_STORAGE_KEY = "vas-summaries";
const STORAGE_PREFIX = "vas-summary:";
const ACCESS_PREFIX = "vas-summary-access:";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACCESS_TOUCH_INTERVAL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 50;

type LegacyCacheIndex = Record<string, CachedSummary>;

function logicalKey(source: string, videoId: string, outputLanguage: OutputLanguage): string {
  return `${source}:${videoId}:${outputLanguage}`;
}

function legacyKey(source: string, videoId: string): string {
  return `${source}:${videoId}`;
}

function storageKey(source: string, videoId: string, outputLanguage: OutputLanguage): string {
  return STORAGE_PREFIX + [source, videoId, outputLanguage].map(encodeURIComponent).join(":");
}

function accessKey(source: string, videoId: string, outputLanguage: OutputLanguage): string {
  return ACCESS_PREFIX + [source, videoId, outputLanguage].map(encodeURIComponent).join(":");
}

function accessKeyForStorageKey(key: string): string {
  return ACCESS_PREFIX + key.slice(STORAGE_PREFIX.length);
}

function asCachedSummary(value: unknown): CachedSummary | null {
  if (!value || typeof value !== "object") return null;
  const item = value as CachedSummary;
  if (
    typeof item.text !== "string" ||
    typeof item.videoTitle !== "string" ||
    typeof item.videoId !== "string" ||
    typeof item.source !== "string" ||
    typeof item.outputLanguage !== "string" ||
    !Number.isFinite(item.timestamp)
  ) return null;
  return item;
}

async function migrateLegacyEntry(
  source: string,
  videoId: string,
  outputLanguage: OutputLanguage,
): Promise<CachedSummary | null> {
  const result = await chrome.storage.local.get(LEGACY_STORAGE_KEY);
  const index = (result[LEGACY_STORAGE_KEY] as LegacyCacheIndex | undefined) ?? {};
  const localizedKey = logicalKey(source, videoId, outputLanguage);
  const oldKey = index[localizedKey]
    ? localizedKey
    : outputLanguage === "zh-CN" && index[legacyKey(source, videoId)]
      ? legacyKey(source, videoId)
      : "";
  if (!oldKey) return null;
  const oldValue = index[oldKey] as Partial<CachedSummary> | undefined;
  if (
    !oldValue ||
    typeof oldValue.text !== "string" ||
    typeof oldValue.videoTitle !== "string" ||
    typeof oldValue.videoId !== "string" ||
    typeof oldValue.source !== "string" ||
    !Number.isFinite(oldValue.timestamp)
  ) return null;

  const entry: CachedSummary = {
    text: oldValue.text,
    videoTitle: oldValue.videoTitle,
    videoId: oldValue.videoId,
    source: oldValue.source,
    outputLanguage,
    timestamp: oldValue.timestamp!,
  };
  await chrome.storage.local.set({
    [storageKey(source, videoId, outputLanguage)]: entry,
    [accessKey(source, videoId, outputLanguage)]: Date.now(),
  });
  delete index[oldKey];
  if (Object.keys(index).length) await chrome.storage.local.set({ [LEGACY_STORAGE_KEY]: index });
  else await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
  return entry;
}

async function cleanupEntries(protectedKey?: string): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const valid: Array<[string, CachedSummary, number]> = [];
  const toRemove: string[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(STORAGE_PREFIX)) continue;
    const entry = asCachedSummary(value);
    if (!entry || now - entry.timestamp > CACHE_TTL_MS) {
      if (key !== protectedKey) toRemove.push(key, accessKeyForStorageKey(key));
    }
    else {
      const lastAccessed = Number(all[accessKeyForStorageKey(key)]);
      valid.push([key, entry, Number.isFinite(lastAccessed) ? lastAccessed : entry.timestamp]);
    }
  }

  for (const key of Object.keys(all)) {
    if (!key.startsWith(ACCESS_PREFIX)) continue;
    const contentKey = STORAGE_PREFIX + key.slice(ACCESS_PREFIX.length);
    if (!(contentKey in all) && contentKey !== protectedKey) toRemove.push(key);
  }

  const overflow = valid.length - MAX_CACHE_ENTRIES;
  if (overflow > 0) {
    valid
      .filter(([key]) => key !== protectedKey)
      .sort((a, b) => a[2] - b[2])
      .slice(0, overflow)
      .forEach(([key]) => toRemove.push(key, accessKeyForStorageKey(key)));
  }
  if (toRemove.length) await chrome.storage.local.remove([...new Set(toRemove)]);
}

export async function getCachedSummary(
  source: string,
  videoId: string,
  outputLanguage: OutputLanguage,
): Promise<CachedSummary | null> {
  const key = storageKey(source, videoId, outputLanguage);
  const accessStorageKey = accessKey(source, videoId, outputLanguage);
  const result = await chrome.storage.local.get([key, accessStorageKey]);
  let entry = asCachedSummary(result[key]);
  if (!entry) entry = await migrateLegacyEntry(source, videoId, outputLanguage);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > CACHE_TTL_MS) {
    return null;
  }
  const lastAccessed = Number(result[accessStorageKey]);
  if (!Number.isFinite(lastAccessed) || now - lastAccessed >= ACCESS_TOUCH_INTERVAL_MS) {
    await chrome.storage.local.set({ [accessStorageKey]: now });
  }
  return entry;
}

export async function setCachedSummary(
  source: string,
  videoId: string,
  videoTitle: string,
  text: string,
  outputLanguage: OutputLanguage,
): Promise<void> {
  const now = Date.now();
  const key = storageKey(source, videoId, outputLanguage);
  const entry: CachedSummary = {
    text,
    videoTitle,
    videoId,
    source,
    outputLanguage,
    timestamp: now,
  };
  await chrome.storage.local.set({
    [key]: entry,
    [accessKey(source, videoId, outputLanguage)]: now,
  });
  await cleanupEntries(key);
}

export async function invalidateCache(
  source: string,
  videoId: string,
  outputLanguage: OutputLanguage,
): Promise<void> {
  await chrome.storage.local.remove([
    storageKey(source, videoId, outputLanguage),
    accessKey(source, videoId, outputLanguage),
  ]);

  const result = await chrome.storage.local.get(LEGACY_STORAGE_KEY);
  const index = (result[LEGACY_STORAGE_KEY] as LegacyCacheIndex | undefined) ?? {};
  delete index[logicalKey(source, videoId, outputLanguage)];
  if (outputLanguage === "zh-CN") delete index[legacyKey(source, videoId)];
  if (Object.keys(index).length) await chrome.storage.local.set({ [LEGACY_STORAGE_KEY]: index });
  else if (result[LEGACY_STORAGE_KEY]) await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
}

export async function clearExpiredCache(): Promise<void> {
  await cleanupEntries();
}
