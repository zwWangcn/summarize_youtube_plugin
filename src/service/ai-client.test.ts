import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIStreamEvent, AIStreamRequest } from "./ai-stream-protocol";
import { summarizeTextStream, translateSummaryStream } from "./ai-client";

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
      queueMicrotask(() => messageListener?.({ type: "done" }));
    }),
    disconnect: vi.fn(),
  };

  vi.stubGlobal("chrome", {
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
});
