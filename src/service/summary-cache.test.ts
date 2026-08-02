import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCachedSummary,
  invalidateCache,
  setCachedSummary,
} from "./summary-cache";

describe("localized summary cache", () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = {};
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        storage: {
          local: {
            get: vi.fn(async (key: string) => ({ [key]: store[key] })),
            set: vi.fn(async (value: Record<string, unknown>) => Object.assign(store, value)),
          },
        },
      },
    });
  });

  it("keeps different output languages independent", async () => {
    await setCachedSummary("youtube", "video-1", "Title", "中文", "zh-CN");
    await setCachedSummary("youtube", "video-1", "Title", "English", "en");

    expect((await getCachedSummary("youtube", "video-1", "zh-CN"))?.text).toBe("中文");
    expect((await getCachedSummary("youtube", "video-1", "en"))?.text).toBe("English");

    await invalidateCache("youtube", "video-1", "zh-CN");
    expect(await getCachedSummary("youtube", "video-1", "zh-CN")).toBeNull();
    expect((await getCachedSummary("youtube", "video-1", "en"))?.text).toBe("English");
  });

  it("migrates a legacy summary only into the Simplified Chinese cache", async () => {
    store["vas-summaries"] = {
      "youtube:video-1": {
        text: "旧总结",
        videoTitle: "Title",
        videoId: "video-1",
        source: "youtube",
        timestamp: Date.now(),
      },
    };

    expect(await getCachedSummary("youtube", "video-1", "en")).toBeNull();
    expect((await getCachedSummary("youtube", "video-1", "zh-CN"))?.text).toBe("旧总结");
    expect(await getCachedSummary("youtube", "video-1", "en")).toBeNull();
  });
});
