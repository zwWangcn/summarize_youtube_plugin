/**
 * Popup 逻辑 — 管理多供应商 AI 模型和 API Key 设置。
 */

import {
  clearAllApiKeys,
  getApiKey,
  getSettings,
  setApiKey,
  setSettings,
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

// ── DOM refs ────────────────────────────────────────────────────────
const providerSelect = document.getElementById("provider") as HTMLSelectElement;
const modelSelect = document.getElementById("model") as HTMLSelectElement;
const outputLanguageSelect = document.getElementById("outputLanguage") as HTMLSelectElement;
const apiKeyInput = document.getElementById("apiKey") as HTMLInputElement;
const toggleKeyBtn = document.getElementById("toggleKey") as HTMLButtonElement;
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const statusDiv = document.getElementById("status") as HTMLDivElement;
const apiKeyLabel = document.getElementById("apiKeyLabel") as HTMLSpanElement;
const apiKeyLink = document.getElementById("apiKeyLink") as HTMLAnchorElement;
const clearKeysBtn = document.getElementById("clearKeysBtn") as HTMLButtonElement;

// Model info card elements
const infoParamSize = document.getElementById("infoParamSize") as HTMLSpanElement;
const infoPricing = document.getElementById("infoPricing") as HTMLSpanElement;
const infoContext = document.getElementById("infoContext") as HTMLSpanElement;
const infoDesc = document.getElementById("infoDesc") as HTMLSpanElement;

// ── State ────────────────────────────────────────────────────────────
let currentProvider: ProviderInfo = PROVIDERS[0];
let currentModel: ModelInfo | null = null;
let apiKeyLoadVersion = 0;

async function loadApiKeyForProvider(providerId: string): Promise<void> {
  const version = ++apiKeyLoadVersion;
  apiKeyInput.value = "";
  apiKeyInput.disabled = true;
  saveBtn.disabled = true;
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
      saveBtn.disabled = false;
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

// Save
saveBtn.addEventListener("click", async () => {
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
      outputLanguage: outputLanguageSelect.value as Awaited<ReturnType<typeof getSettings>>["outputLanguage"],
    });
    logI18nDebug("popup settings saved", {
      chromeUiLocale: getUiLocale(),
      outputLanguage: outputLanguageSelect.value,
      providerId: pid,
      modelId: mid,
    });
    showStatus(t("settingsSaved"), "success");
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
    saveBtn.disabled = false;
    showStatus(t("allApiKeysCleared"), "success");
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.debug("[vas] Clear API keys failed:", detail);
    showStatus(t("clearApiKeysFailed"), "error");
  } finally {
    apiKeyInput.disabled = false;
    saveBtn.disabled = false;
  }
});

// ── Status helper ───────────────────────────────────────────────────
function showStatus(message: string, type: "success" | "error"): void {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  setTimeout(() => {
    statusDiv.className = "status";
  }, 2500);
}

// ── Run ─────────────────────────────────────────────────────────────
init();
