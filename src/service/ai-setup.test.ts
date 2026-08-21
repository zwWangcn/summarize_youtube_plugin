import { describe, expect, it } from "vitest";
import { createAISetupStatus } from "./ai-setup";

describe("AI setup status", () => {
  it("reports readiness for the selected provider without exposing the key", () => {
    expect(createAISetupStatus({ id: "openai", name: "OpenAI GPT" }, " sk-secret "))
      .toEqual({ providerId: "openai", providerName: "OpenAI GPT", hasKey: true });
    expect(createAISetupStatus({ id: "deepseek", name: "DeepSeek" }, ""))
      .toEqual({ providerId: "deepseek", providerName: "DeepSeek", hasKey: false });
  });
});
