import { describe, expect, it } from "vitest";
import { openaiCompatAdapter } from "./openai-compat";
import { getAIRequestProfile, resolveAISelection } from "../model-registry";

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

  it("keeps Qwen 3.7 Flash translation requests in non-thinking mode", () => {
    const model = "qwen3.7-flash";
    const body = JSON.parse(openaiCompatAdapter.buildStreamRequest({
      ...base,
      ...getAIRequestProfile("qwen", model),
      model,
      disableThinking: true,
    }).body);
    expect(body).toMatchObject({ model, enable_thinking: false, max_tokens: 16384 });
    expect(body).not.toHaveProperty("thinking");
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

  it("uses the GPT-5.6 no-reasoning value", () => {
    const request = openaiCompatAdapter.buildStreamRequest({
      ...base,
      model: "gpt-5.6-luna",
      disableThinking: true,
      thinkingControl: "openai",
    });
    expect(JSON.parse(request.body).reasoning_effort).toBe("none");
  });

  it("does not send provider-specific thinking fields by default", () => {
    const request = openaiCompatAdapter.buildStreamRequest(base);
    expect(JSON.parse(request.body)).not.toHaveProperty("thinking");
  });

  it.each(["moonshot", "zhipu"])("disables thinking using the %s request contract", (provider) => {
    const selection = resolveAISelection(provider, provider === "moonshot" ? "kimi-k2.5" : "glm-5.2");
    const profile = getAIRequestProfile(provider, selection.model.id);
    const body = JSON.parse(openaiCompatAdapter.buildStreamRequest({
      ...base,
      ...profile,
      model: selection.model.id,
      temperature: profile.supportsTemperature ? 0.2 : undefined,
      disableThinking: true,
    }).body);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body).not.toHaveProperty("reasoning_effort");
    if (provider === "moonshot") {
      expect(body.model).toBe("kimi-k2.6");
      expect(body).not.toHaveProperty("temperature");
    }
  });
});
