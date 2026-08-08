import { describe, expect, it } from "vitest";
import {
  getAIRequestProfile,
  getModelForProvider,
  normalizeModelId,
  resolveAISelection,
} from "./model-registry";

describe("model request contracts", () => {
  it("normalizes the previously shipped invalid Anthropic IDs", () => {
    expect(normalizeModelId("claude-sonnet-5-20250702")).toBe("claude-sonnet-5");
    expect(normalizeModelId("claude-opus-4-8-20250515")).toBe("claude-opus-4-8");
    expect(getModelForProvider("anthropic", "claude-sonnet-5-20250702")?.id)
      .toBe("claude-sonnet-5");
  });

  it("omits unsupported sampling parameters and selects provider-specific fields", () => {
    expect(getAIRequestProfile("anthropic", "claude-sonnet-5").supportsTemperature)
      .toBe(false);
    expect(getAIRequestProfile("openai", "gpt-5").supportsTemperature).toBe(false);
    expect(getAIRequestProfile("openai", "gpt-5")).toMatchObject({
      thinkingControl: "openai",
      instructionRole: "developer",
    });
    expect(getAIRequestProfile("openai", "gpt-5").maxOutputTokensField)
      .toBe("max_completion_tokens");
    expect(getAIRequestProfile("qwen", "qwen3.5-flash").thinkingControl)
      .toBe("qwen");
  });

  it("resolves a mismatched provider/model pair atomically", () => {
    const selection = resolveAISelection("anthropic", "gpt-5");
    expect(selection.provider.id).toBe("anthropic");
    expect(selection.model.provider).toBe("anthropic");
  });
});
