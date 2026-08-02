import type { TranslatedSegment } from "./transcript-translation";
import type { OutputLanguage } from "../utils/i18n";

export interface TranslationCacheIdentity {
  videoId: string;
  sourceLanguage: string;
  providerId: string;
  modelId: string;
  targetLanguage: OutputLanguage;
}

export interface CachedTranslationSection {
  chunkId: number;
  targetStart: number;
  targetEnd: number;
  segments: TranslatedSegment[];
  timestamp: number;
}

export interface CachedTranslation extends TranslationCacheIdentity {
  pipelineVersion: number;
  sections: Record<string, CachedTranslationSection>;
  timestamp: number;
}

const STORAGE_KEY = "vas-translations";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;
const PIPELINE_VERSION = 2;

type CacheIndex = Record<string, CachedTranslation>;

function makeKey(identity: TranslationCacheIdentity): string {
  return [
    "youtube",
    identity.videoId,
    identity.sourceLanguage,
    identity.targetLanguage,
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
    const entry = index[key];
    if (
      entry.pipelineVersion !== PIPELINE_VERSION ||
      now - entry.timestamp > CACHE_TTL_MS
    ) {
      delete index[key];
    }
  }
}

export async function getCachedTranslation(
  identity: TranslationCacheIdentity,
): Promise<CachedTranslation | null> {
  const index = await readIndex();
  const now = Date.now();
  removeExpired(index, now);
  const cached = index[makeKey(identity)];
  await writeIndex(index);
  return cached ?? null;
}

export async function setCachedTranslationSection(
  identity: TranslationCacheIdentity,
  section: Omit<CachedTranslationSection, "timestamp">,
): Promise<CachedTranslation> {
  const index = await readIndex();
  const now = Date.now();
  removeExpired(index, now);
  const key = makeKey(identity);
  const current = index[key];
  const next: CachedTranslation = {
    ...identity,
    pipelineVersion: PIPELINE_VERSION,
    sections: { ...(current?.sections ?? {}) },
    timestamp: now,
  };
  next.sections[String(section.chunkId)] = { ...section, timestamp: now };
  index[key] = next;

  const keys = Object.keys(index);
  if (keys.length > MAX_CACHE_ENTRIES) {
    keys
      .sort((a, b) => index[a].timestamp - index[b].timestamp)
      .slice(0, keys.length - MAX_CACHE_ENTRIES)
      .forEach((oldKey) => delete index[oldKey]);
  }
  await writeIndex(index);
  return next;
}

export async function invalidateTranslationSection(
  identity: TranslationCacheIdentity,
  chunkId: number,
): Promise<void> {
  const index = await readIndex();
  const key = makeKey(identity);
  const current = index[key];
  if (!current) return;
  delete current.sections[String(chunkId)];
  current.timestamp = Date.now();
  await writeIndex(index);
}

export async function invalidateTranslation(
  identity: TranslationCacheIdentity,
): Promise<void> {
  const index = await readIndex();
  delete index[makeKey(identity)];
  await writeIndex(index);
}
