/** 翻译缓存：每个翻译 section 独立存储，避免并发完成的 section 互相覆盖。 */

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

interface StoredSection extends TranslationCacheIdentity {
  pipelineVersion: number;
  section: CachedTranslationSection;
}

const LEGACY_STORAGE_KEY = "vas-translations";
const STORAGE_PREFIX = "vas-translation-section:";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;
const PIPELINE_VERSION = 4;

function identityKey(identity: TranslationCacheIdentity): string {
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

function identityPrefix(identity: TranslationCacheIdentity): string {
  return `${STORAGE_PREFIX}${identityKey(identity)}:`;
}

function sectionStorageKey(identity: TranslationCacheIdentity, chunkId: number): string {
  return `${identityPrefix(identity)}${chunkId}`;
}

function asStoredSection(value: unknown): StoredSection | null {
  if (!value || typeof value !== "object") return null;
  const item = value as StoredSection;
  const section = item.section;
  if (
    item.pipelineVersion !== PIPELINE_VERSION ||
    !section ||
    !Number.isInteger(section.chunkId) ||
    !Number.isInteger(section.targetStart) ||
    !Number.isInteger(section.targetEnd) ||
    !Array.isArray(section.segments) ||
    !Number.isFinite(section.timestamp)
  ) return null;
  return item;
}

async function readAllSections(): Promise<Record<string, unknown>> {
  const all = await chrome.storage.local.get(null);
  if (all[LEGACY_STORAGE_KEY]) {
    // v3 之前的结果缺少 source-ID 覆盖校验，不能安全复用。
    await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
    delete all[LEGACY_STORAGE_KEY];
  }
  return all;
}

async function cleanupSections(protectedIdentityKey?: string): Promise<void> {
  const all = await readAllSections();
  const now = Date.now();
  const toRemove: string[] = [];
  const identities = new Map<string, { timestamp: number; keys: string[] }>();

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(STORAGE_PREFIX)) continue;
    const groupKey = key.slice(STORAGE_PREFIX.length, key.lastIndexOf(":"));
    const stored = asStoredSection(value);
    if (!stored || now - stored.section.timestamp > CACHE_TTL_MS) {
      if (groupKey !== protectedIdentityKey) toRemove.push(key);
      continue;
    }
    const group = identities.get(groupKey) ?? { timestamp: 0, keys: [] };
    group.timestamp = Math.max(group.timestamp, stored.section.timestamp);
    group.keys.push(key);
    identities.set(groupKey, group);
  }

  const overflow = identities.size - MAX_CACHE_ENTRIES;
  if (overflow > 0) {
    [...identities.entries()]
      .filter(([key]) => key !== protectedIdentityKey)
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, overflow)
      .forEach(([, group]) => toRemove.push(...group.keys));
  }
  if (toRemove.length) await chrome.storage.local.remove([...new Set(toRemove)]);
}

export async function getCachedTranslation(
  identity: TranslationCacheIdentity,
): Promise<CachedTranslation | null> {
  const all = await readAllSections();
  const prefix = identityPrefix(identity);
  const now = Date.now();
  const sections: Record<string, CachedTranslationSection> = {};
  let timestamp = 0;

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(prefix)) continue;
    const stored = asStoredSection(value);
    if (!stored || now - stored.section.timestamp > CACHE_TTL_MS) {
      continue;
    }
    sections[String(stored.section.chunkId)] = stored.section;
    timestamp = Math.max(timestamp, stored.section.timestamp);
  }
  if (!Object.keys(sections).length) return null;
  return { ...identity, pipelineVersion: PIPELINE_VERSION, sections, timestamp };
}

export async function setCachedTranslationSection(
  identity: TranslationCacheIdentity,
  section: Omit<CachedTranslationSection, "timestamp">,
): Promise<void> {
  const timestamp = Date.now();
  const stored: StoredSection = {
    ...identity,
    pipelineVersion: PIPELINE_VERSION,
    section: { ...section, timestamp },
  };
  await chrome.storage.local.set({
    [sectionStorageKey(identity, section.chunkId)]: stored,
  });
  await cleanupSections(identityKey(identity));
}

export async function invalidateTranslationSection(
  identity: TranslationCacheIdentity,
  chunkId: number,
): Promise<void> {
  await chrome.storage.local.remove(sectionStorageKey(identity, chunkId));
}
