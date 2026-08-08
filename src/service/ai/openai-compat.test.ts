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
      thinkingControl: "deepseek",
    });
    expect(JSON.parse(request.body).thinking).toEqual({ type: "disabled" });
  });

  it("uses Qwen's thinking switch and the selected output-token field", () => {
    const request = openaiCompatAdapter.buildStreamRequest({
      ...base,
      disableThinking: true,
      thinkingControl: "qwen",
      maxOutputTokensField: "max_completion_tokens",
    });
    expect(JSON.parse(request.body)).toMatchObject({
      enable_thinking: false,
      max_completion_tokens: 16384,
    });
    expect(JSON.parse(request.body)).not.toHaveProperty("max_tokens");
  });

  it("uses OpenAI reasoning controls and developer instructions", () => {
    const request = openaiCompatAdapter.buildStreamRequest({
      ...base,
      disableThinking: true,
      thinkingControl: "openai",
      instructionRole: "developer",
      maxOutputTokensField: "max_completion_tokens",
    });
    const body = JSON.parse(request.body);
    expect(body.reasoning_effort).toBe("minimal");
    expect(body.messages[0]).toEqual({ role: "developer", content: "system" });
  });

  it("does not send provider-specific thinking fields by default", () => {
    const request = openaiCompatAdapter.buildStreamRequest(base);
    expect(JSON.parse(request.body)).not.toHaveProperty("thinking");
  });
});
