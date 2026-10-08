import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const selectedAI = vi.hoisted(() => ({ provider: "deepseek", model: "deepseek-v4-flash" }));

vi.mock("./storage", () => ({
  getSettings: vi.fn(async () => ({
    ...selectedAI,
    outputLanguage: "en",
  })),
  getApiKey: vi.fn(async () => "test-key"),
}));

import { streamAIText } from "./ai";

describe("AI stream cancellation", () => {
  beforeEach(() => {
    Object.assign(selectedAI, { provider: "deepseek", model: "deepseek-v4-flash" });
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
    vi.useRealTimers();
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

  it("automatically retries a Failed to fetch network error", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"content":"recovered"},"finish_reason":"stop"}]}\n\n',
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ));
    vi.stubGlobal("fetch", fetchMock);

    const result = (async () => {
      let text = "";
      for await (const chunk of streamAIText("system", "user", { maxRetries: 1 })) {
        text += chunk;
      }
      return text;
    })();

    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("parses data fields without a space and flushes the final SSE event", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      'data:{"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}]}',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    )));

    let result = "";
    for await (const chunk of streamAIText("system", "user", { maxRetries: 0 })) {
      result += chunk;
    }
    expect(result).toBe("hello");
  });

  it("rejects a successful HTTP stream that contains no content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "data: [DONE]\n\n",
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    )));

    const consume = async () => {
      for await (const _chunk of streamAIText("system", "user", { maxRetries: 0 })) {
        // Empty response is expected to throw.
      }
    };
    await expect(consume()).rejects.toMatchObject({ name: "AIServiceError" });
  });

  it("does not silently swallow in-band provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      'data: {"error":{"message":"quota exceeded"}}\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    )));

    const consume = async () => {
      for await (const _chunk of streamAIText("system", "user", { maxRetries: 0 })) {
        // Provider error is expected to throw.
      }
    };
    await expect(consume()).rejects.toThrow("quota exceeded");
  });

  it.each([
    ["openai", "gpt-5.6-luna", { model: "gpt-6-luna", reasoning_effort: "none" }],
    ["openai", "gpt-5.6-sol", { model: "gpt-6.1-sol", reasoning_effort: "low" }],
    ["anthropic", "claude-sonnet-5", { model: "claude-sonnet-5-5", thinking: { type: "between_tools" }, output_config: { effort: "low" } }],
    ["anthropic", "claude-opus-5", { model: "claude-opus-5-5", thinking: { type: "adaptive" }, output_config: { effort: "low" } }],
    ["zhipu", "glm-4.5", { model: "glm-5.3-flash", thinking: { type: "enabled" }, reasoning_effort: "low" }],
    ["gemini", "gemini-3.7-flash", { generationConfig: { thinkingConfig: { thinkingLevel: "low" } } }],
  ])("migrates saved %s / %s before sending a translation request", async (provider, model, expected) => {
    Object.assign(selectedAI, { provider, model });
    const chunk = provider === "anthropic"
      ? { type: "content_block_delta", delta: { type: "text_delta", text: "translated" } }
      : provider === "gemini"
      ? { candidates: [{ content: { parts: [{ text: "translated" }] }, finishReason: "STOP" }] }
      : { choices: [{ delta: { content: "translated" }, finish_reason: "stop" }] };
    const fetchMock = vi.fn(async () => new Response(`data: ${JSON.stringify(chunk)}\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    let result = "";
    for await (const token of streamAIText("system", "user", {
      disableThinking: true,
      temperature: 0,
      maxRetries: 0,
    })) result += token;
    expect(result).toBe("translated");
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject(expected);
    if (provider !== "zhipu") expect(body).not.toHaveProperty("temperature");
  });
});
