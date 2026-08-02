import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./storage", () => ({
  getSettings: vi.fn(async () => ({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    outputLanguage: "en",
  })),
  getApiKey: vi.fn(async () => "test-key"),
}));

import { streamAIText } from "./ai";

describe("AI stream cancellation", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        i18n: {
          getMessage: vi.fn((key: string) => key),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not retry an old request when cancellation happens during backoff", async () => {
    const fetchMock = vi.fn(async () => new Response("temporary failure", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "debug").mockImplementation(() => {});

    const controller = new AbortController();
    const consume = (async () => {
      for await (const _chunk of streamAIText("system", "user", {
        maxRetries: 1,
        signal: controller.signal,
      })) {
        // The mocked response never yields a token.
      }
    })();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(consume).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
