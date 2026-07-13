/**
 * Popup 逻辑 — 管理多供应商 AI 模型和 API Key 设置。
 */

import { getSettings, setSettings } from "../service/storage";
import {
  PROVIDERS,
  getModelsByProvider,
  getModel,
  formatPricing,
  formatContextWindow,
} from "../service/model-registry";
import type { ProviderInfo, ModelInfo } from "../service/model-registry";

// ── DOM refs ────────────────────────────────────────────────────────
const providerSelect = document.getElementById("provider") as HTMLSelectElement;
const modelSelect = document.getElementById("model") as HTMLSelectElement;
const apiKeyInput = document.getElementById("apiKey") as HTMLInputElement;
const toggleKeyBtn = document.getElementById("toggleKey") as HTMLButtonElement;
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const statusDiv = document.getElementById("status") as HTMLDivElement;
const apiKeyLabel = document.getElementById("apiKeyLabel") as HTMLSpanElement;
const apiKeyLink = document.getElementById("apiKeyLink") as HTMLAnchorElement;

// Model info card elements
const infoParamSize = document.getElementById("infoParamSize") as HTMLSpanElement;
const infoPricing = document.getElementById("infoPricing") as HTMLSpanElement;
const infoContext = document.getElementById("infoContext") as HTMLSpanElement;
const infoDesc = document.getElementById("infoDesc") as HTMLSpanElement;

// ── State ────────────────────────────────────────────────────────────
let currentProvider: ProviderInfo = PROVIDERS[0];
let currentModel: ModelInfo | null = null;

// ── Init ─────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  // Populate provider dropdown
  for (const p of PROVIDERS) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name}`;
    providerSelect.appendChild(opt);
  }

  // Load saved settings
  const settings = await getSettings();
  const savedProvider = settings.provider || "deepseek";
  const savedModel = settings.model || "deepseek-v4-flash";

  // Set provider
  providerSelect.value = savedProvider;
  currentProvider = PROVIDERS.find((p) => p.id === savedProvider) ?? PROVIDERS[0];
  populateModels(currentProvider.id);
  modelSelect.value = savedModel;
  currentModel = getModel(savedModel) ?? null;
  updateModelInfo();
  updateApiKeyUI(currentProvider);

  // Load saved API key for this provider
  apiKeyInput.value = settings.apiKeys[savedProvider] ?? "";
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
  infoPricing.textContent = `${formatPricing(currentModel.pricing)} / 1M tokens`;
  infoContext.textContent = formatContextWindow(currentModel.contextWindow);
  infoDesc.textContent = currentModel.description;
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
  getSettings().then((s) => {
    apiKeyInput.value = s.apiKeys[pid] ?? "";
  });
});

// Model changed → update info card
modelSelect.addEventListener("change", () => {
  currentModel = getModel(modelSelect.value) ?? null;
  updateModelInfo();
});

// Toggle key visibility
let keyVisible = false;
toggleKeyBtn.addEventListener("click", () => {
  keyVisible = !keyVisible;
  apiKeyInput.type = keyVisible ? "text" : "password";
  toggleKeyBtn.textContent = keyVisible ? "隐藏" : "显示";
});

// Save
saveBtn.addEventListener("click", async () => {
  try {
    const pid = providerSelect.value;
    const mid = modelSelect.value;
    const key = apiKeyInput.value.trim();

    // Get current apiKeys and update the selected provider's key
    const currentSettings = await getSettings();
    const apiKeys = { ...currentSettings.apiKeys };
    apiKeys[pid] = key;

    await setSettings({
      apiKeys,
      provider: pid,
      model: mid,
    });
    showStatus("设置已保存", "success");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "保存失败";
    showStatus(msg, "error");
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
