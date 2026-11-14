import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freeCacheSpace, setLocalWithQuotaFallback } from "./storage-quota";

const QUOTA_BYTES = 10_000;
let store: Record<string, unknown>;

function size(items: Record<string, unknown>): number {
  return Object.entries(items).reduce((total, [key, value]) => total + key.length + JSON.stringify(value).length, 0);
}

function summary(id: string, timestamp: number, bytes = 1_000) {
  return { [`vas-summary:youtube:${id}:en`]: { text: "x".repeat(bytes), timestamp } };
}

function section(id: string, chunk: number, timestamp: number, bytes = 1_000) {
  return { [`vas-translation-section:youtube:${id}:en:zh-CN:p:m:15:fp:${chunk}`]: {
    section: { chunkId: chunk, timestamp, segments: ["y".repeat(bytes)] },
  } };
}

describe("storage.local quota fallback", () => {
  beforeEach(() => {
    store = {};
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.stubGlobal("chrome", { storage: { local: {
      get: vi.fn(async () => ({ ...store })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        if (size({ ...store, ...items }) > QUOTA_BYTES) {
          throw new Error("Resource::kQuotaBytes quota exceeded");
        }
        Object.assign(store, items);
      }),
      remove: vi.fn(async (keys: string[]) => { for (const key of keys) delete store[key]; }),
    } } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("evicts the oldest caches and saves an API key when storage is full", async () => {
    Object.assign(store,
      summary("old", 1), summary("mid", 2), summary("new", 3),
      section("video-a", 0, 4), section("video-a", 1, 4), section("video-b", 0, 5), section("video-b", 1, 5),
      { "vas-api-key:openai": "sk-existing", uiLanguage: "en" });
    const key = { "vas-api-key:deepseek": "sk-" + "k".repeat(3_000) };
    expect(size({ ...store, ...key })).toBeGreaterThan(QUOTA_BYTES);

    await setLocalWithQuotaFallback(key);

    // First write hit the quota, the retry after eviction succeeded.
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(2);
    expect(store["vas-api-key:deepseek"]).toBeDefined();
    // Non-cache data is never touched.
    expect(store["vas-api-key:openai"]).toBe("sk-existing");
    expect(store.uiLanguage).toBe("en");
    // Oldest half of 5 groups (3 summaries + 2 translations) = 3 oldest summaries.
    expect(Object.keys(store).filter((key) => key.startsWith("vas-summary:"))).toEqual([]);
    expect(Object.keys(store).filter((key) => key.startsWith("vas-translation-section:"))).toHaveLength(4);
  });

  it("evicts a translation as a whole group and keeps the group being written", async () => {
    Object.assign(store, section("video-a", 0, 1), section("video-a", 1, 1), section("video-b", 0, 9));
    // video-a is older, but its new section is being written: video-b goes instead.
    await freeCacheSpace(Object.keys(section("video-a", 2, 10)));
    expect(Object.keys(store).sort()).toEqual([
      ...Object.keys(section("video-a", 0, 1)), ...Object.keys(section("video-a", 1, 1)),
    ].sort());
  });

  it("rethrows errors that are not quota errors without evicting anything", async () => {
    Object.assign(store, summary("old", 1));
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error("Extension context invalidated"));
    await expect(setLocalWithQuotaFallback({ key: "value" })).rejects.toThrow("context invalidated");
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    expect(Object.keys(store)).toHaveLength(1);
  });
});
