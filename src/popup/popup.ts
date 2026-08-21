/**
 * Popup 逻辑 — 管理分页设置、多供应商 AI 模型和 API Key。
 */

import {
  clearAllApiKeys,
  getApiKey,
  getSettings,
  setApiKey,
  setSettings,
  type Settings,
} from "../service/storage";
import {
  PROVIDERS,
  getModelsByProvider,
  getModelForProvider,
  resolveAISelection,
  formatPricing,
  formatContextWindow,
} from "../service/model-registry";
import type { ProviderInfo, ModelInfo } from "../service/model-registry";
import { OUTPUT_LANGUAGES, getUiLocale, t } from "../utils/i18n";
import { logI18nDebug } from "../utils/i18n-debug";
import {
  DEFAULT_SUBTITLE_STYLE,
  normalizeSubtitleStyle,
  type SubtitleStyleSettings,
} from "../service/subtitle-style";
import {
  getAdjacentPopupTab,
  isPopupTabId,
  type PopupTabId,
} from "./popup-tabs";

// ── DOM refs ────────────────────────────────────────────────────────
const providerSelect = document.getElementById("provider") as HTMLSelectElement;
const modelSelect = document.getElementById("model") as HTMLSelectElement;
const outputLanguageSelect = document.getElementById("outputLanguage") as HTMLSelectElement;
const learningModeInput = document.getElementById("learningMode") as HTMLInputElement;
const apiKeyInput = document.getElementById("apiKey") as HTMLInputElement;
const toggleKeyBtn = document.getElementById("toggleKey") as HTMLButtonElement;
const saveAiBtn = document.getElementById("saveAiBtn") as HTMLButtonElement;
const statusDiv = document.getElementById("status") as HTMLDivElement;
const apiKeyLabel = document.getElementById("apiKeyLabel") as HTMLSpanElement;
const apiKeyLink = document.getElementById("apiKeyLink") as HTMLAnchorElement;
const clearKeysBtn = document.getElementById("clearKeysBtn") as HTMLButtonElement;
const tabButtons = [...document.querySelectorAll<HTMLButtonElement>("[role='tab'][data-tab]")];
const tabPanels = [...document.querySelectorAll<HTMLElement>("[role='tabpanel'][data-panel]")];
const sourceFontScaleInput = document.getElementById("sourceFontScale") as HTMLInputElement;
const translationFontScaleInput = document.getElementById("translationFontScale") as HTMLInputElement;
const sourceColorInput = document.getElementById("sourceColor") as HTMLInputElement;
const translationColorInput = document.getElementById("translationColor") as HTMLInputElement;
const sourceFontScaleValue = document.getElementById("sourceFontScaleValue") as HTMLOutputElement;
const translationFontScaleValue = document.getElementById("translationFontScaleValue") as HTMLOutputElement;
const sourceColorValue = document.getElementById("sourceColorValue") as HTMLSpanElement;
const translationColorValue = document.getElementById("translationColorValue") as HTMLSpanElement;
const sourcePreview = document.getElementById("sourcePreview") as HTMLParagraphElement;
const translationPreview = document.getElementById("translationPreview") as HTMLParagraphElement;

// Model info card elements
const infoParamSize = document.getElementById("infoParamSize") as HTMLSpanElement;
const infoPricing = document.getElementById("infoPricing") as HTMLSpanElement;
const infoContext = document.getElementById("infoContext") as HTMLSpanElement;
const infoDesc = document.getElementById("infoDesc") as HTMLSpanElement;

// ── State ────────────────────────────────────────────────────────────
let currentProvider: ProviderInfo = PROVIDERS[0];
let currentModel: ModelInfo | null = null;
let apiKeyLoadVersion = 0;
let statusTimer: ReturnType<typeof setTimeout> | null = null;
let subtitleStyleSaveTimer: ReturnType<typeof setTimeout> | null = null;
let subtitleStyle: SubtitleStyleSettings = { ...DEFAULT_SUBTITLE_STYLE };

async function loadApiKeyForProvider(providerId: string): Promise<void> {
  const version = ++apiKeyLoadVersion;
  apiKeyInput.value = "";
  apiKeyInput.disabled = true;
  saveAiBtn.disabled = true;
  try {
    const key = await getApiKey(providerId);
    if (version === apiKeyLoadVersion && providerSelect.value === providerId) {
      apiKeyInput.value = key;
    }
  } catch (err) {
    if (version === apiKeyLoadVersion && providerSelect.value === providerId) {
      apiKeyInput.value = "";
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.debug("[vas] API key load failed:", detail);
    }
  } finally {
    if (version === apiKeyLoadVersion && providerSelect.value === providerId) {
      apiKeyInput.disabled = false;
      saveAiBtn.disabled = false;
    }
  }
}

// ── Init ─────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  document.documentElement.lang = getUiLocale();
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n!);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((element) => {
    element.title = t(element.dataset.i18nTitle!);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel!));
  });

  // Populate provider dropdown
  for (const p of PROVIDERS) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name}`;
    providerSelect.appendChild(opt);
  }
  for (const language of OUTPUT_LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = language.code;
    opt.textContent = language.nativeName;
    outputLanguageSelect.appendChild(opt);
  }

  // Load saved settings
  const settings = await getSettings();
  const selection = resolveAISelection(settings.provider, settings.model);
  const savedProvider = selection.provider.id;
  const savedModel = selection.model.id;
  outputLanguageSelect.value = settings.outputLanguage;
  learningModeInput.checked = settings.learningModeEnabled;
  subtitleStyle = settings.subtitleStyle;
  renderSubtitleTypography();
  logI18nDebug("popup settings loaded", {
    chromeUiLocale: getUiLocale(),
    outputLanguage: settings.outputLanguage,
    providerId: savedProvider,
    modelId: savedModel,
  });

  // Set provider
  currentProvider = selection.provider;
  providerSelect.value = currentProvider.id;
  populateModels(currentProvider.id);
  modelSelect.value = savedModel;
  currentModel = selection.model;
  updateModelInfo();
  updateApiKeyUI(currentProvider);
  // Load saved API key for this provider
  await loadApiKeyForProvider(currentProvider.id);
}

function activateTab(tabId: PopupTabId, focus: boolean = false): void {
  for (const button of tabButtons) {
    const selected = button.dataset.tab === tabId;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  }
  for (const panel of tabPanels) {
    const selected = panel.dataset.panel === tabId;
    panel.classList.toggle("is-active", selected);
    panel.hidden = !selected;
  }
}

async function saveAutomaticSettings(
  partial: Partial<Pick<Settings, "outputLanguage" | "learningModeEnabled">>,
): Promise<void> {
  try {
    await setSettings(partial);
    showStatus(t("settingsSaved"), "success");
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.debug("[vas] Automatic settings save failed:", detail);
    showStatus(t("saveFailed"), "error");
  }
}

function renderSubtitleTypography(): void {
  sourceFontScaleInput.value = String(subtitleStyle.sourceFontScale);
  translationFontScaleInput.value = String(subtitleStyle.translationFontScale);
  sourceColorInput.value = subtitleStyle.sourceColor;
  translationColorInput.value = subtitleStyle.translationColor;
  sourceFontScaleValue.value = `${subtitleStyle.sourceFontScale}%`;
  translationFontScaleValue.value = `${subtitleStyle.translationFontScale}%`;
  sourceColorValue.textContent = subtitleStyle.sourceColor;
  translationColorValue.textContent = subtitleStyle.translationColor;
  sourcePreview.style.fontSize = `${13 * subtitleStyle.sourceFontScale / 100}px`;
  translationPreview.style.fontSize = `${15 * subtitleStyle.translationFontScale / 100}px`;
  sourcePreview.style.color = subtitleStyle.sourceColor;
  translationPreview.style.color = subtitleStyle.translationColor;
}

async function saveSubtitleStyle(): Promise<void> {
  if (subtitleStyleSaveTimer) {
    clearTimeout(subtitleStyleSaveTimer);
    subtitleStyleSaveTimer = null;
  }
  try {
    await setSettings({ subtitleStyle: { ...subtitleStyle } });
    showStatus(t("settingsSaved"), "success");
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.debug("[vas] Subtitle style save failed:", detail);
    showStatus(t("saveFailed"), "error");
  }
}

function updateSubtitleTypography(): void {
  subtitleStyle = normalizeSubtitleStyle({
    ...subtitleStyle,
    preset: "custom",
    sourceFontScale: Number(sourceFontScaleInput.value),
    translationFontScale: Number(translationFontScaleInput.value),
    sourceColor: sourceColorInput.value,
    translationColor: translationColorInput.value,
  });
  renderSubtitleTypography();
  if (subtitleStyleSaveTimer) clearTimeout(subtitleStyleSaveTimer);
  subtitleStyleSaveTimer = setTimeout(() => {
    subtitleStyleSaveTimer = null;
    void saveSubtitleStyle();
  }, 300);
}

// ── Populate model dropdown for a given provider ─────────────────────
function populateModels(providerId: string): void {
  modelSelect.innerHTML = "";
  const models = getModelsByProvider(providerId);
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    const symbol = m.pricing.currency === "CNY" ? "¥" : "$";
    opt.textContent = `${m.name} · ${symbol}${m.pricing.input}/M`;
    modelSelect.appendChild(opt);
  }
}

// ── Update model info card ───────────────────────────────────────────
function updateModelInfo(): void {
  if (!currentModel) {
    infoParamSize.textContent = "—";
    infoPricing.textContent = "—";
    infoContext.textContent = "—";
    infoDesc.textContent = "—";
    return;
  }
  infoParamSize.textContent = currentModel.paramSize;
  infoPricing.textContent = t("perMillionTokens", formatPricing(currentModel.pricing));
  infoContext.textContent = formatContextWindow(currentModel.contextWindow);
  infoDesc.textContent = t(currentModel.descriptionKey);
}

// ── Update API Key UI for a given provider ───────────────────────────
function updateApiKeyUI(provider: ProviderInfo): void {
  apiKeyLabel.textContent = `${provider.name} API Key`;
  apiKeyLink.href = provider.docsUrl;
  apiKeyLink.textContent = provider.docsUrl.length > 40
    ? provider.docsUrl.slice(0, 40) + "…"
    : provider.docsUrl;
  apiKeyInput.placeholder = provider.id === "anthropic"
    ? "sk-ant-..."
    : provider.id === "gemini"
      ? "AIza..."
      : "sk-...";
}

// ── Events ───────────────────────────────────────────────────────────

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    if (isPopupTabId(button.dataset.tab)) activateTab(button.dataset.tab);
  });
  button.addEventListener("keydown", (event) => {
    if (!isPopupTabId(button.dataset.tab)) return;
    const next = getAdjacentPopupTab(button.dataset.tab, event.key);
    if (!next) return;
    event.preventDefault();
    activateTab(next, true);
  });
}

outputLanguageSelect.addEventListener("change", () => {
  void saveAutomaticSettings({
    outputLanguage: outputLanguageSelect.value as Settings["outputLanguage"],
  });
});

learningModeInput.addEventListener("change", () => {
  void saveAutomaticSettings({ learningModeEnabled: learningModeInput.checked });
});

for (const input of [
  sourceFontScaleInput,
  translationFontScaleInput,
  sourceColorInput,
  translationColorInput,
]) {
  input.addEventListener("input", updateSubtitleTypography);
  input.addEventListener("change", () => void saveSubtitleStyle());
}

// Provider changed → repopulate models
providerSelect.addEventListener("change", () => {
  const pid = providerSelect.value;
  currentProvider = PROVIDERS.find((p) => p.id === pid) ?? PROVIDERS[0];
  populateModels(pid);

  // Select first model by default
  const firstModel = getModelsByProvider(pid)[0];
  if (firstModel) {
    modelSelect.value = firstModel.id;
    currentModel = firstModel;
  }
  updateModelInfo();
  updateApiKeyUI(currentProvider);

  // Reload saved API key for new provider
  void loadApiKeyForProvider(pid);
});

// Model changed → update info card
modelSelect.addEventListener("change", () => {
  currentModel = getModelForProvider(providerSelect.value, modelSelect.value) ?? null;
  updateModelInfo();
});

// Toggle key visibility
let keyVisible = false;
toggleKeyBtn.addEventListener("click", () => {
  keyVisible = !keyVisible;
  apiKeyInput.type = keyVisible ? "text" : "password";
  toggleKeyBtn.textContent = t(keyVisible ? "hideKey" : "showKey");
});

// Save AI configuration and the selected provider's local API key.
saveAiBtn.addEventListener("click", async () => {
  try {
    const pid = providerSelect.value;
    const mid = modelSelect.value;
    const key = apiKeyInput.value.trim();

    if (!getModelForProvider(pid, mid)) {
      throw new Error(`Invalid provider/model selection: ${pid}/${mid}`);
    }

    await setApiKey(pid, key);

    await setSettings({
      provider: pid,
      model: mid,
    });
    logI18nDebug("popup settings saved", {
      chromeUiLocale: getUiLocale(),
      outputLanguage: outputLanguageSelect.value,
      providerId: pid,
      modelId: mid,
    });
    showStatus(t("aiSettingsSaved"), "success");
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.debug("[vas] Settings save failed:", detail);
    showStatus(t("saveFailed"), "error");
  }
});

clearKeysBtn.addEventListener("click", async () => {
  if (!window.confirm(t("clearAllApiKeysConfirm"))) return;
  try {
    apiKeyLoadVersion += 1;
    await clearAllApiKeys();
    apiKeyInput.value = "";
    apiKeyInput.disabled = false;
    saveAiBtn.disabled = false;
    showStatus(t("allApiKeysCleared"), "success");
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.debug("[vas] Clear API keys failed:", detail);
    showStatus(t("clearApiKeysFailed"), "error");
  } finally {
    apiKeyInput.disabled = false;
    saveAiBtn.disabled = false;
  }
});

// ── Status helper ───────────────────────────────────────────────────
function showStatus(message: string, type: "success" | "error"): void {
  if (statusTimer) clearTimeout(statusTimer);
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusTimer = setTimeout(() => {
    statusDiv.className = "status";
    statusTimer = null;
  }, 2500);
}

// ── Run ─────────────────────────────────────────────────────────────
init();
