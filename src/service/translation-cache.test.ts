import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCachedTranslation,
  invalidateTranslationSection,
  setCachedTranslationSection,
  type TranslationCacheIdentity,
} from "./translation-cache";

const identity: TranslationCacheIdentity = {
  videoId: "video-1",
  sourceLanguage: "en",
  providerId: "openai",
  modelId: "gpt-test",
  targetLanguage: "zh-CN",
};

function translated(cueId: number, start: number, duration: number, text: string) {
  return {
    cueId,
    sourceStartId: cueId,
    sourceEndId: cueId,
    start,
    duration,
    text,
  };
}

describe("section translation cache", () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = {};
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        storage: {
          local: {
            get: vi.fn(async (query?: string | string[] | null) => {
              if (query == null) return { ...store };
              if (Array.isArray(query)) {
                return Object.fromEntries(query.map((key) => [key, store[key]]));
              }
              return { [query]: store[query] };
            }),
            set: vi.fn(async (value: Record<string, unknown>) => {
              Object.assign(store, value);
            }),
            remove: vi.fn(async (keys: string | string[]) => {
              for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
            }),
          },
        },
      },
    });
  });

  it("merges independently completed sections and supports a section retry", async () => {
    await setCachedTranslationSection(identity, {
      chunkId: 0,
      targetStart: 0,
      targetEnd: 2,
      segments: [translated(0, 0, 3, "第一段")],
    });
    expect((await getCachedTranslation(identity))?.pipelineVersion).toBe(8);
    await setCachedTranslationSection(identity, {
      chunkId: 2,
      targetStart: 5,
      targetEnd: 7,
      segments: [translated(5, 10, 3, "第三段")],
    });

    expect(Object.keys((await getCachedTranslation(identity))!.sections)).toEqual(["0", "2"]);

    await invalidateTranslationSection(identity, 0);
    expect(Object.keys((await getCachedTranslation(identity))!.sections)).toEqual(["2"]);
  });

  it("isolates caches by model identity", async () => {
    await setCachedTranslationSection(identity, {
      chunkId: 0,
      targetStart: 0,
      targetEnd: 0,
      segments: [translated(0, 0, 1, "译文")],
    });

    expect(await getCachedTranslation({ ...identity, modelId: "other-model" })).toBeNull();
  });

  it("isolates caches by target language", async () => {
    await setCachedTranslationSection(identity, {
      chunkId: 0,
      targetStart: 0,
      targetEnd: 0,
      segments: [translated(0, 0, 1, "译文")],
    });

    expect(await getCachedTranslation({ ...identity, targetLanguage: "en" })).toBeNull();
  });

  it("keeps concurrently completed sections", async () => {
    await Promise.all([
      setCachedTranslationSection(identity, {
        chunkId: 0,
        targetStart: 0,
        targetEnd: 1,
        segments: [translated(0, 0, 2, "第一段")],
      }),
      setCachedTranslationSection(identity, {
        chunkId: 1,
        targetStart: 2,
        targetEnd: 3,
        segments: [translated(2, 2, 2, "第二段")],
      }),
    ]);
    expect(Object.keys((await getCachedTranslation(identity))!.sections).sort())
      .toEqual(["0", "1"]);
  });
});
