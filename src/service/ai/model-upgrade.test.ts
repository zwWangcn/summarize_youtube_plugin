import { describe, expect, it } from "vitest";
import { getAIRequestProfile } from "../model-registry";
import { anthropicAdapter } from "./anthropic";
import { geminiAdapter } from "./gemini";

const base = {
  systemPrompt: "Translate subtitles",
  userPrompt: "Hello",
  apiKey: "test",
  baseURL: "https://api.example.com",
};

describe("new model translation contracts", () => {
  it.each([
    ["claude-sonnet-5-5", "between_tools"],
    ["claude-haiku-5-5", "disabled"],
    ["claude-opus-5-5", "adaptive"],
    ["claude-fable-5-1", "adaptive"],
  ])("uses valid low-latency thinking on %s", (model, thinkingType) => {
    const profile = getAIRequestProfile("anthropic", model);
    const body = JSON.parse(anthropicAdapter.buildStreamRequest({
      ...base,
      ...profile,
      model,
      temperature: profile.supportsTemperature ? 0 : undefined,
      disableThinking: true,
    }).body);
    expect(body.thinking).toEqual({ type: thinkingType });
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body).not.toHaveProperty("temperature");
  });

  it("preserves default adaptive thinking for Claude summaries", () => {
    const body = JSON.parse(anthropicAdapter.buildStreamRequest({
      ...base,
      ...getAIRequestProfile("anthropic", "claude-sonnet-5-5"),
      model: "claude-sonnet-5-5",
    }).body);
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("output_config");
  });

  it.each(["gemini-3.8-flash", "gemini-3.1-pro-preview"])("uses %s low thinking without leaking the key into the URL", (model) => {
    const request = geminiAdapter.buildStreamRequest({
      ...base,
      ...getAIRequestProfile("gemini", model),
      model,
      disableThinking: true,
    });
    expect(JSON.parse(request.body).generationConfig).toEqual({
      maxOutputTokens: 16384,
      thinkingConfig: { thinkingLevel: "low" },
    });
    expect(request.url).toBe(`https://api.example.com/models/${model}:streamGenerateContent?alt=sse`);
    expect(request.headers["x-goog-api-key"]).toBe("test");
  });

  it("does not mix Gemini thinking summaries with translated subtitles", () => {
    expect(geminiAdapter.parseStreamChunk({
      candidates: [{ content: { parts: [
        { thought: true, text: "reasoning" },
        { text: "你好" },
        { thoughtSignature: "signature" },
      ] }, finishReason: "STOP" }],
    })).toEqual({ token: "你好", finishReason: "STOP" });
  });
});
