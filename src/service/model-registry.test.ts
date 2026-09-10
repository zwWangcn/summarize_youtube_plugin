import { describe, expect, it } from "vitest";
import {
  getAIRequestProfile,
  getModelForProvider,
  normalizeModelId,
  resolveAISelection,
} from "./model-registry";

describe("model request contracts", () => {
  it("upgrades both saved Opus IDs and preserves the sampling restriction", () => {
    for (const id of ["claude-opus-4-8", "claude-opus-4-8-20250515", "claude-opus-5"]) {
      expect(resolveAISelection("anthropic", id).model.id).toBe("claude-opus-5");
      expect(getAIRequestProfile("anthropic", id).supportsTemperature).toBe(false);
    }
  });

  it("offers Qwen 3.7 Flash without migrating existing 3.5 Flash selections", () => {
    for (const id of ["qwen3.7-flash", "qwen3.5-flash"]) {
      expect(resolveAISelection("qwen", id).model.id).toBe(id);
      expect(getAIRequestProfile("qwen", id).thinkingControl).toBe("qwen");
    }
  });

  it("migrates retired or invalid IDs to callable models", () => {
    for (const [provider, oldId, currentId] of [
      ["deepseek", "deepseek-v4-flash", "deepseek-flash"],
      ["moonshot", "kimi-k2.5", "kimi-k2.6"],
      ["moonshot", "kimi-k2.6-thinking", "kimi-k2.6"],
      ["grok", "grok-4.1-fast", "grok-4.3"],
    ]) {
      expect(resolveAISelection(provider, oldId).model.id).toBe(currentId);
      expect(normalizeModelId(currentId)).toBe(currentId);
    }
    expect(getAIRequestProfile("moonshot", "kimi-k2.5")).toMatchObject({
      supportsTemperature: false,
      thinkingControl: "thinking",
    });
  });

  it("normalizes the previously shipped invalid Anthropic IDs", () => {
    expect(normalizeModelId("claude-sonnet-5-20250702")).toBe("claude-sonnet-5");
    expect(normalizeModelId("claude-opus-4-8-20250515")).toBe("claude-opus-5");
    expect(getModelForProvider("anthropic", "claude-sonnet-5-20250702")?.id)
      .toBe("claude-sonnet-5");
    expect(getModelForProvider("openai", "gpt-5")?.id).toBe("gpt-5.6-sol");
    expect(getModelForProvider("gemini", "gemini-2.5-flash")?.id)
      .toBe("gemini-3.7-flash");
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
});
