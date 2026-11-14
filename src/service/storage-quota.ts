/**
 * chrome.storage.local quota fallback.
 *
 * Without `unlimitedStorage`, storage.local holds about 10 MB. The summary and
 * translation caches only speed things up, but they write first and clean up
 * afterwards: once storage was full every write failed, cleanup never ran
 * (not even for expired entries), caching stayed broken for good and saving an
 * API key failed too. On a quota error we now evict the oldest half of the
 * cache entries and retry once. Nothing but cache keys is ever removed.
 */

const SUMMARY_PREFIX = "vas-summary:";
const SUMMARY_ACCESS_PREFIX = "vas-summary-access:";
const TRANSLATION_PREFIX = "vas-translation-section:";

export function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /quota/i.test(message);
}

/** Entries that are evicted together: one summary, or all sections of one translation. */
function cacheGroupId(key: string): string | null {
  if (key.startsWith(SUMMARY_PREFIX)) return key;
  if (key.startsWith(SUMMARY_ACCESS_PREFIX)) {
    return SUMMARY_PREFIX + key.slice(SUMMARY_ACCESS_PREFIX.length);
  }
  if (key.startsWith(TRANSLATION_PREFIX)) return key.slice(0, key.lastIndexOf(":"));
  return null;
}

function entryTimestamp(value: unknown): number {
  const item = value as { timestamp?: unknown; section?: { timestamp?: unknown } } | null;
  const timestamp = Number(item?.section?.timestamp ?? item?.timestamp);
  // Unreadable entries go first.
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Removes the oldest half of the cache groups (at least one), except groups
 * that the pending write belongs to. Returns the number of removed keys.
 */
export async function freeCacheSpace(protectedKeys: Iterable<string> = []): Promise<number> {
  const protectedGroups = new Set(
    [...protectedKeys].map(cacheGroupId).filter((id): id is string => id !== null),
  );
  const all = await chrome.storage.local.get(null);
  const groups = new Map<string, { keys: string[]; timestamp: number }>();
  for (const [key, value] of Object.entries(all)) {
    const id = cacheGroupId(key);
    if (!id || protectedGroups.has(id)) continue;
    const group = groups.get(id) ?? { keys: [], timestamp: 0 };
    group.keys.push(key);
    // Access-time keys store a bare number; content entries carry timestamps.
    if (!key.startsWith(SUMMARY_ACCESS_PREFIX)) {
      group.timestamp = Math.max(group.timestamp, entryTimestamp(value));
    }
    groups.set(id, group);
  }
  const ordered = [...groups.values()].sort((a, b) => a.timestamp - b.timestamp);
  const evicted = ordered.slice(0, Math.ceil(ordered.length / 2)).flatMap((group) => group.keys);
  if (evicted.length) await chrome.storage.local.remove(evicted);
  return evicted.length;
}

/** chrome.storage.local.set that frees cache space and retries once when full. */
export async function setLocalWithQuotaFallback(items: Record<string, unknown>): Promise<void> {
  try {
    await chrome.storage.local.set(items);
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    const removed = await freeCacheSpace(Object.keys(items));
    console.debug("[vas] storage.local is full; evicted old cache entries:", removed);
    await chrome.storage.local.set(items);
  }
}
