import { describe, expect, it } from "vitest";
import {
  PROVIDERS,
  getAIRequestProfile,
  getModelForProvider,
  normalizeModelId,
  resolveAISelection,
} from "./model-registry";

describe("model request contracts", () => {
  it("upgrades both saved Opus IDs and preserves the sampling restriction", () => {
    for (const id of ["claude-opus-4-8", "claude-opus-4-8-20250515", "claude-opus-5"]) {
      expect(resolveAISelection("anthropic", id).model.id).toBe("claude-opus-5-5");
      expect(getAIRequestProfile("anthropic", id).supportsTemperature).toBe(false);
    }
  });

  it("migrates both previous Qwen Flash selections to 3.8", () => {
    for (const id of ["qwen3.7-flash", "qwen3.5-flash"]) {
      expect(resolveAISelection("qwen", id).model.id).toBe("qwen3.8-flash");
      expect(getAIRequestProfile("qwen", id).thinkingControl).toBe("qwen");
    }
  });

  it("migrates retired or invalid IDs to callable models", () => {
    for (const [provider, oldId, currentId] of [
      ["deepseek", "deepseek-v4-flash", "deepseek-flash"],
      ["moonshot", "kimi-k2.5", "kimi-k3"],
      ["moonshot", "kimi-k2.6-thinking", "kimi-k3"],
      ["moonshot", "kimi-k2.6", "kimi-k3"],
      ["grok", "grok-4.1-fast", "grok-4.7"],
      ["grok", "grok-4.3", "grok-4.7"],
      ["openai", "gpt-5.6-sol", "gpt-6.1-sol"],
      ["openai", "gpt-5.6-terra", "gpt-6.1-sol"],
      ["openai", "gpt-5.6-luna", "gpt-6-luna"],
      ["anthropic", "claude-sonnet-5", "claude-sonnet-5-5"],
      ["anthropic", "claude-haiku-4-5-20251001", "claude-haiku-5-5"],
      ["gemini", "gemini-3.7-flash", "gemini-3.8-flash"],
      ["gemini", "gemini-2.5-pro", "gemini-3.1-pro-preview"],
      ["qwen", "qwen3-max", "qwen3.8-max"],
      ["qwen", "qwen3.5-plus", "qwen3.7-plus"],
      ["zhipu", "glm-5.2", "glm-5.3"],
      ["zhipu", "glm-4.5", "glm-5.3-flash"],
      ["zhipu", "glm-4.5-air", "glm-5.3-flash"],
    ]) {
      expect(resolveAISelection(provider, oldId).model.id).toBe(currentId);
      expect(normalizeModelId(currentId)).toBe(currentId);
      expect(normalizeModelId(oldId)).toBe(currentId);
      expect(getModelForProvider(provider, oldId)?.id).toBe(currentId);
      expect(PROVIDERS.find((p) => p.id === provider)?.models.some((m) => m.id === oldId))
        .toBe(false);
    }
    expect(getAIRequestProfile("moonshot", "kimi-k2.5")).toMatchObject({
      supportsTemperature: false,
      thinkingControl: "reasoning",
      minimumReasoningEffort: "low",
    });
  });

  it("normalizes the previously shipped invalid Anthropic IDs", () => {
    expect(normalizeModelId("claude-sonnet-5-20250702")).toBe("claude-sonnet-5-5");
    expect(normalizeModelId("claude-opus-4-8-20250515")).toBe("claude-opus-5-5");
    expect(getModelForProvider("anthropic", "claude-sonnet-5-20250702")?.id)
      .toBe("claude-sonnet-5-5");
    expect(getModelForProvider("openai", "gpt-5")?.id).toBe("gpt-6.1-sol");
    expect(getModelForProvider("gemini", "gemini-2.5-flash")?.id)
      .toBe("gemini-3.8-flash");
  });

  it("omits unsupported sampling parameters and selects provider-specific fields", () => {
    expect(getAIRequestProfile("anthropic", "claude-sonnet-5").supportsTemperature)
      .toBe(false);
    expect(getAIRequestProfile("openai", "gpt-5.6-sol").supportsTemperature).toBe(false);
    expect(getAIRequestProfile("openai", "gpt-5.6-sol")).toMatchObject({
      thinkingControl: "openai",
      instructionRole: "developer",
    });
    expect(getAIRequestProfile("openai", "gpt-5.6-sol").maxOutputTokensField)
      .toBe("max_completion_tokens");
    expect(getAIRequestProfile("gemini", "gemini-3.7-flash").supportsTemperature)
      .toBe(false);
    expect(getAIRequestProfile("qwen", "qwen3.5-flash").thinkingControl)
      .toBe("qwen");
  });

  it("resolves a mismatched provider/model pair atomically", () => {
    const selection = resolveAISelection("anthropic", "gpt-5");
    expect(selection.provider.id).toBe("anthropic");
    expect(selection.model.provider).toBe("anthropic");
  });

  it("keeps every provider default valid and removes GPT-5 from the picker", () => {
    for (const provider of PROVIDERS) {
      expect(resolveAISelection(provider.id, undefined).model).toBe(provider.models[0]);
      for (const model of provider.models) {
        expect(normalizeModelId(model.id)).toBe(model.id);
        expect(model.provider).toBe(provider.id);
      }
    }
    expect(PROVIDERS.find((p) => p.id === "openai")?.models.map((m) => m.id))
      .toEqual(["gpt-6.1-sol", "gpt-6-luna", "gpt-6-astra"]);
  });
});
