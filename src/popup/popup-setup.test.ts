import { describe, expect, it } from "vitest";
import {
  getApiKeyUiState,
  getInitialPopupTab,
  normalizeRequiredApiKey,
} from "./popup-setup";

describe("popup API key setup state", () => {
  it("opens AI setup only when the active provider has no key", () => {
    expect(getInitialPopupTab(false)).toBe("ai");
    expect(getInitialPopupTab(true)).toBe("general");
  });

  it("requires a non-empty key and trims accepted input", () => {
    expect(normalizeRequiredApiKey("  ")).toBeNull();
    expect(normalizeRequiredApiKey(" sk-test ")).toBe("sk-test");
  });

  it("distinguishes missing, saved, and unsaved input", () => {
    expect(getApiKeyUiState("", "")).toBe("missing");
    expect(getApiKeyUiState("", "new-key")).toBe("modified");
    expect(getApiKeyUiState("saved-key", "saved-key")).toBe("saved");
    expect(getApiKeyUiState("saved-key", "changed-key")).toBe("modified");
  });
});
