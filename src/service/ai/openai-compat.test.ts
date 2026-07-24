import { describe, expect, it } from "vitest";
import { openaiCompatAdapter } from "./openai-compat";

describe("openai-compatible request body", () => {
  const base = {
    model: "deepseek-v4-flash",
    systemPrompt: "system",
    userPrompt: "user",
    apiKey: "test",
    baseURL: "https://api.example.com",
  };

  it("adds the DeepSeek thinking-off switch when requested", () => {
    const request = openaiCompatAdapter.buildStreamRequest({
      ...base,
      disableThinking: true,
    });
    expect(JSON.parse(request.body).thinking).toEqual({ type: "disabled" });
  });

  it("does not send provider-specific thinking fields by default", () => {
    const request = openaiCompatAdapter.buildStreamRequest(base);
    expect(JSON.parse(request.body)).not.toHaveProperty("thinking");
  });
});
