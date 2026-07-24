import type { TranslatedSegment } from "./transcript-translation";

export interface TranslationCacheIdentity {
  videoId: string;
  sourceLanguage: string;
  providerId: string;
  modelId: string;
}

export interface CachedTranslation extends TranslationCacheIdentity {
  targetLanguage: "zh-CN";
  pipelineVersion: number;
  segments: TranslatedSegment[];
  timestamp: number;
}

const STORAGE_KEY = "vas-translations";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;
const PIPELINE_VERSION = 1;

type CacheIndex = Record<string, CachedTranslation>;

function makeKey(identity: TranslationCacheIdentity): string {
  return [
    "youtube",
    identity.videoId,
    identity.sourceLanguage,
    "zh-CN",
    identity.providerId,
    identity.modelId,
    PIPELINE_VERSION,
  ].map(encodeURIComponent).join(":");
}

async function readIndex(): Promise<CacheIndex> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as CacheIndex) ?? {};
}

async function writeIndex(index: CacheIndex): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: index });
}

function removeExpired(index: CacheIndex, now: number): void {
  for (const key of Object.keys(index)) {
    if (now - index[key].timestamp > CACHE_TTL_MS) delete index[key];
  }
}

export async function getCachedTranslation(
  identity: TranslationCacheIdentity,
): Promise<CachedTranslation | null> {
  const index = await readIndex();
  const key = makeKey(identity);
  const cached = index[key];
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    delete index[key];
    await writeIndex(index);
    return null;
  }
  return cached;
}

export async function setCachedTranslation(
  identity: TranslationCacheIdentity,
  segments: TranslatedSegment[],
): Promise<void> {
  const index = await readIndex();
  const now = Date.now();
  removeExpired(index, now);
  const key = makeKey(identity);
  index[key] = {
    ...identity,
    targetLanguage: "zh-CN",
    pipelineVersion: PIPELINE_VERSION,
    segments,
    timestamp: now,
  };

  const keys = Object.keys(index);
  if (keys.length > MAX_CACHE_ENTRIES) {
    keys
      .sort((a, b) => index[a].timestamp - index[b].timestamp)
      .slice(0, keys.length - MAX_CACHE_ENTRIES)
      .forEach((oldKey) => delete index[oldKey]);
  }
  await writeIndex(index);
}

export async function invalidateTranslation(
  identity: TranslationCacheIdentity,
): Promise<void> {
  const index = await readIndex();
  delete index[makeKey(identity)];
  await writeIndex(index);
}
