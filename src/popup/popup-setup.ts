import type { PopupTabId } from "./popup-tabs";

export type ApiKeyUiState = "missing" | "saved" | "modified";

export function getInitialPopupTab(hasActiveApiKey: boolean): PopupTabId {
  return hasActiveApiKey ? "general" : "ai";
}

export function normalizeRequiredApiKey(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

export function getApiKeyUiState(savedKey: string, inputValue: string): ApiKeyUiState {
  const normalizedSaved = savedKey.trim();
  const normalizedInput = inputValue.trim();
  if (!normalizedSaved) return normalizedInput ? "modified" : "missing";
  return normalizedInput === normalizedSaved ? "saved" : "modified";
}
