import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIStreamEvent, AIStreamRequest } from "./ai-stream-protocol";
import { summarizeTextStream, summaryInputCharBudget, translateSummaryStream } from "./ai-client";
import { PROVIDERS } from "./model-registry";

vi.mock("./storage", () => ({
  getSettings: vi.fn(async () => ({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    outputLanguage: "zh-CN",
  })),
}));

interface MockPortControl {
  requests: AIStreamRequest[];
}

function installMockPort(): MockPortControl {
  const requests: AIStreamRequest[] = [];
  let messageListener: ((event: AIStreamEvent) => void) | undefined;

  const port = {
    onMessage: {
      addListener: vi.fn((listener: (event: AIStreamEvent) => void) => {
        messageListener = listener;
      }),
      removeListener: vi.fn(),
    },
    onDisconnect: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    postMessage: vi.fn((request: AIStreamRequest) => {
      requests.push(request);
      queueMicrotask(() => {
        messageListener?.({ type: "token", token: "ok" });
        messageListener?.({ type: "done" });
      });
    }),
    disconnect: vi.fn(),
  };

  vi.stubGlobal("chrome", {
    i18n: {
      getMessage: vi.fn((key: string) => key),
    },
    runtime: {
      connect: vi.fn(() => port),
    },
  });
  return { requests };
}

async function consume(stream: AsyncGenerator<string>): Promise<void> {
  for await (const _chunk of stream) {
    // The mock closes without tokens; only the submitted request is under test.
  }
}

describe("localized summary AI requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses temperature zero for summary generation", async () => {
    const { requests } = installMockPort();
    vi.spyOn(console, "info").mockImplementation(() => {});

    await consume(summarizeTextStream("[00:00] transcript", "zh-CN"));

    expect(requests).toHaveLength(1);
    expect(requests[0].options).toMatchObject({
      disableThinking: true,
      temperature: 0,
    });
  });

  it("applies the selected customization to summary generation and translation", async () => {
    const { requests } = installMockPort();
    vi.spyOn(console, "info").mockImplementation(() => {});

    await consume(summarizeTextStream(
      "[00:00] Smolder scales late",
      "zh-CN",
      undefined,
      "Smolder 固定译为斯莫德。",
    ));
    await consume(translateSummaryStream(
      "## Smolder",
      "zh-CN",
      undefined,
      "Smolder 固定译为斯莫德。",
    ));

    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.systemPrompt.includes("Smolder 固定译为斯莫德。")))
      .toBe(true);
  });

  it("uses temperature zero for language repair", async () => {
    const { requests } = installMockPort();

    await consume(translateSummaryStream("## 日本語の要約", "zh-CN"));

    expect(requests).toHaveLength(1);
    expect(requests[0].options).toMatchObject({
      disableThinking: true,
      temperature: 0,
    });
    expect(requests[0].userPrompt).toContain("<<<START OF SUMMARY>>>");
  });

  it("reduces oversized transcripts in sections instead of dropping the middle", async () => {
    const { requests } = installMockPort();
    vi.spyOn(console, "info").mockImplementation(() => {});

    const transcript = `${"a".repeat(120_000)}\n${"middle-marker"}\n${"z".repeat(120_000)}`;
    await consume(summarizeTextStream(
      transcript,
      "zh-CN",
      undefined,
      "Keep game item names consistent.",
    ));

    expect(requests).toHaveLength(3);
    expect(requests[0].userPrompt).toContain("section 1 of 2");
    expect(requests.slice(0, 2).some((request) => request.userPrompt.includes("middle-marker")))
      .toBe(true);
    expect(requests[2].userPrompt).toContain("REDUCED TRANSCRIPT NOTES");
    expect(requests.every((request) => (
      request.systemPrompt.includes("Keep game item names consistent.")
    ))).toBe(true);
    expect(requests.some((request) => request.userPrompt.includes("middle omitted"))).toBe(false);
  });

  it("stops before issuing an excessive number of paid reduction requests", async () => {
    const { requests } = installMockPort();

    await expect(consume(summarizeTextStream("x".repeat(2_600_000), "zh-CN")))
      .rejects.toMatchObject({ name: "AIServiceError", retryable: false });
    expect(requests).toHaveLength(0);
  });
});

describe("summary input budget", () => {
  // Characters are not tokens. CJK / Thai captions can cost ~1.5 tokens per
  // character, so the budget must fit even then, plus the 16k default output
  // and prompt overhead. Fails if a small-context model is ever registered.
  it.each(PROVIDERS.flatMap((provider) => provider.models.map((model) => [provider.id, model.id, model.contextWindow] as const)))(
    "fits %s / %s worst-case token usage into its context window",
    (_provider, _model, contextWindow) => {
      const worstCaseTokens = summaryInputCharBudget(contextWindow) * 1.5 + 16_384 + 8_000;
      expect(worstCaseTokens).toBeLessThanOrEqual(contextWindow);
    },
  );
});
