/**
 * Popup 逻辑 — 管理分页设置、多供应商 AI 模型和 API Key。
 */

import {
  clearAllApiKeys,
  deleteCustomPromptProfile,
  getApiKey,
  getCustomPromptProfiles,
  getSettings,
  saveCustomPromptProfile,
  setApiKey,
  setSettings,
  type Settings,
} from "../service/storage";
import {
  CustomPromptValidationError,
  MAX_CUSTOM_PROMPT_INSTRUCTION_CHARS,
  MAX_CUSTOM_PROMPT_NAME_CHARS,
  MAX_CUSTOM_PROMPT_PROFILES,
  truncateUnicode,
  unicodeLength,
  type CustomPromptProfile,
} from "../service/ai-controls";
import {
  PROVIDERS,
  getModelsByProvider,
  getModelForProvider,
  resolveAISelection,
  formatContextWindow,
} from "../service/model-registry";
import type { ProviderInfo, ModelInfo } from "../service/model-registry";
import {
  OUTPUT_LANGUAGES,
  UI_LANGUAGES,
  getUiLocale,
  isUiLanguage,
  t as chromeT,
  type UiLanguage,
} from "../utils/i18n";
import { logI18nDebug } from "../utils/i18n-debug";
import {
  loadPopupTranslator,
  type PopupTranslator,
} from "./popup-i18n";
import {
  DEFAULT_SUBTITLE_STYLE,
  getSubtitleContainerCssValues,
  normalizeSubtitleStyle,
  type SubtitleStyleSettings,
} from "../service/subtitle-style";
import {
  getAdjacentPopupTab,
  isPopupTabId,
  type PopupTabId,
} from "./popup-tabs";
import {
  getApiKeyUiState,
  getInitialPopupTab,
  normalizeRequiredApiKey,
} from "./popup-setup";

// ── DOM refs ────────────────────────────────────────────────────────
const providerSelect = document.getElementById("provider") as HTMLSelectElement;
const modelSelect = document.getElementById("model") as HTMLSelectElement;
const uiLanguageSelect = document.getElementById("uiLanguage") as HTMLSelectElement;
const outputLanguageSelect = document.getElementById("outputLanguage") as HTMLSelectElement;
const learningModeInput = document.getElementById("learningMode") as HTMLInputElement;
const bilingualDefaultInput = document.getElementById("bilingualDefault") as HTMLInputElement;
const translationOnlyInput = document.getElementById("translationOnly") as HTMLInputElement;
const learningModeRow = document.getElementById("learningModeRow") as HTMLElement;
const apiKeyInput = document.getElementById("apiKey") as HTMLInputElement;
const toggleKeyBtn = document.getElementById("toggleKey") as HTMLButtonElement;
const saveAiBtn = document.getElementById("saveAiBtn") as HTMLButtonElement;
const statusDiv = document.getElementById("status") as HTMLDivElement;
const apiKeyLabel = document.getElementById("apiKeyLabel") as HTMLSpanElement;
const apiKeyLink = document.getElementById("apiKeyLink") as HTMLAnchorElement;
const apiKeyState = document.getElementById("apiKeyState") as HTMLSpanElement;
const apiKeyError = document.getElementById("apiKeyError") as HTMLParagraphElement;
const setupGuide = document.getElementById("setupGuide") as HTMLElement;
const setupComplete = document.getElementById("setupComplete") as HTMLElement;
const aiTabButton = document.getElementById("tab-ai") as HTMLButtonElement;
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
const previewCaptionCard = document.querySelector(".preview-caption-card") as HTMLDivElement;
const backgroundOpacityInput = document.getElementById("backgroundOpacity") as HTMLInputElement;
const subtitleMaxWidthInput = document.getElementById("subtitleMaxWidth") as HTMLInputElement;
const backgroundOpacityValue = document.getElementById("backgroundOpacityValue") as HTMLOutputElement;
const subtitleMaxWidthValue = document.getElementById("subtitleMaxWidthValue") as HTMLOutputElement;
const customPromptSelect = document.getElementById("customPromptSelect") as HTMLSelectElement;
const newPromptBtn = document.getElementById("newPromptBtn") as HTMLButtonElement;
const editPromptBtn = document.getElementById("editPromptBtn") as HTMLButtonElement;
const deletePromptBtn = document.getElementById("deletePromptBtn") as HTMLButtonElement;
const promptEditor = document.getElementById("promptEditor") as HTMLElement;
const promptNameInput = document.getElementById("promptName") as HTMLInputElement;
const promptInstructionInput = document.getElementById("promptInstruction") as HTMLTextAreaElement;
const promptError = document.getElementById("promptError") as HTMLParagraphElement;
const promptCharCount = document.getElementById("promptCharCount") as HTMLSpanElement;
const cancelPromptBtn = document.getElementById("cancelPromptBtn") as HTMLButtonElement;
const savePromptBtn = document.getElementById("savePromptBtn") as HTMLButtonElement;
const translationChunkPresetSelect = document.getElementById("translationChunkPreset") as HTMLSelectElement;
const translationChunkHint = document.getElementById("translationChunkHint") as HTMLParagraphElement;

// Model info card elements
const infoParamSize = document.getElementById("infoParamSize") as HTMLSpanElement;
const infoContext = document.getElementById("infoContext") as HTMLSpanElement;
const infoDesc = document.getElementById("infoDesc") as HTMLSpanElement;

// ── State ────────────────────────────────────────────────────────────
let currentProvider: ProviderInfo = PROVIDERS[0];
let currentModel: ModelInfo | null = null;
let apiKeyLoadVersion = 0;
let aiSelectionSaveVersion = 0;
let savedApiKey = "";
let setupJustCompleted = false;
let persistedProviderId = PROVIDERS[0].id;
let persistedModelId = PROVIDERS[0].models[0].id;
let statusTimer: ReturnType<typeof setTimeout> | null = null;
let subtitleStyleSaveTimer: ReturnType<typeof setTimeout> | null = null;
let subtitleStyle: SubtitleStyleSettings = { ...DEFAULT_SUBTITLE_STYLE };
let activeUiLanguage: UiLanguage = "en";
let t: PopupTranslator = chromeT;
let customPromptProfiles: CustomPromptProfile[] = [];
let editingPromptId: string | null = null;

async function loadApiKeyForProvider(providerId: string): Promise<void> {
  const version = ++apiKeyLoadVersion;
  savedApiKey = "";
  setupJustCompleted = false;
  apiKeyInput.value = "";
  clearApiKeyError();
  updateSetupUi();
  apiKeyInput.disabled = true;
  saveAiBtn.disabled = true;
  try {
    const key = await getApiKey(providerId);
    if (version === apiKeyLoadVersion && providerSelect.value === providerId) {
      savedApiKey = key;
      apiKeyInput.value = key;
      updateSetupUi();
    }
  } catch (err) {
    if (version === apiKeyLoadVersion && providerSelect.value === providerId) {
      apiKeyInput.value = "";
      savedApiKey = "";
      updateSetupUi();
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
  const settings = await getSettings();
  activeUiLanguage = settings.uiLanguage;
  try {
    t = await loadPopupTranslator(activeUiLanguage, chromeT);
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.debug("[vas] UI catalog load failed:", detail);
  }
  renderLocalizedUi();

  for (const language of UI_LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = language.code;
    opt.textContent = language.nativeName;
    uiLanguageSelect.appendChild(opt);
  }
  uiLanguageSelect.value = activeUiLanguage;

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

  // Apply saved settings
  const selection = resolveAISelection(settings.provider, settings.model);
  const savedProvider = selection.provider.id;
  const savedModel = selection.model.id;
  persistedProviderId = savedProvider;
  persistedModelId = savedModel;
  outputLanguageSelect.value = settings.outputLanguage;
  learningModeInput.checked = settings.learningModeEnabled;
  bilingualDefaultInput.checked = settings.bilingualSubtitlesDefaultEnabled;
  translationOnlyInput.checked = settings.translationOnlyEnabled;
  customPromptProfiles = await getCustomPromptProfiles();
  translationChunkPresetSelect.value = settings.translationChunkPreset;
  renderCustomPromptSelect(settings.activeCustomPromptId);
  updateTranslationChunkHint();
  updateSubtitleModeAvailability();
  subtitleStyle = settings.subtitleStyle;
  renderSubtitleTypography();
  logI18nDebug("popup settings loaded", {
    chromeUiLocale: getUiLocale(),
    uiLanguage: activeUiLanguage,
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
  activateTab(getInitialPopupTab(Boolean(savedApiKey)));
}

function renderLocalizedUi(): void {
  document.documentElement.lang = activeUiLanguage;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n!);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((element) => {
    element.title = t(element.dataset.i18nTitle!);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel!));
  });
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-i18n-placeholder]")
    .forEach((element) => {
      element.placeholder = t(element.dataset.i18nPlaceholder!);
    });
  renderCustomPromptSelect(customPromptSelect.value || null);
  updateTranslationChunkHint();
  updateModelInfo();
  updateApiKeyUI(currentProvider);
  updateSetupUi();
  toggleKeyBtn.textContent = t(keyVisible ? "hideKey" : "showKey");
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
  partial: Partial<Pick<
    Settings,
    | "outputLanguage"
    | "learningModeEnabled"
    | "translationOnlyEnabled"
    | "bilingualSubtitlesDefaultEnabled"
    | "activeCustomPromptId"
    | "translationChunkPreset"
  >>,
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

function updateSubtitleModeAvailability(): void {
  const translationOnly = translationOnlyInput.checked;
  learningModeInput.disabled = translationOnly;
  learningModeRow.classList.toggle("is-disabled", translationOnly);
  learningModeRow.setAttribute("aria-disabled", String(translationOnly));
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
  backgroundOpacityInput.value = String(subtitleStyle.backgroundOpacity);
  subtitleMaxWidthInput.value = String(subtitleStyle.maxWidth);
  backgroundOpacityValue.value = `${subtitleStyle.backgroundOpacity}%`;
  subtitleMaxWidthValue.value = `${subtitleStyle.maxWidth}%`;
  const container = getSubtitleContainerCssValues(subtitleStyle);
  previewCaptionCard.style.background = container.background;
  previewCaptionCard.style.boxShadow = container.boxShadow;
  previewCaptionCard.style.maxWidth = container.maxWidth;
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
    backgroundOpacity: Number(backgroundOpacityInput.value),
    maxWidth: Number(subtitleMaxWidthInput.value),
  });
  renderSubtitleTypography();
  if (subtitleStyleSaveTimer) clearTimeout(subtitleStyleSaveTimer);
  subtitleStyleSaveTimer = setTimeout(() => {
    subtitleStyleSaveTimer = null;
    void saveSubtitleStyle();
  }, 300);
}

function renderCustomPromptSelect(activeId: string | null): void {
  customPromptSelect.innerHTML = "";
  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = t("customPromptNone");
  customPromptSelect.appendChild(noneOption);
  for (const profile of customPromptProfiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    customPromptSelect.appendChild(option);
  }
  customPromptSelect.value = customPromptProfiles.some((profile) => profile.id === activeId)
    ? activeId!
    : "";
  updateCustomPromptButtons();
}

function updateCustomPromptButtons(): void {
  const hasSelection = Boolean(customPromptSelect.value);
  newPromptBtn.disabled = customPromptProfiles.length >= MAX_CUSTOM_PROMPT_PROFILES;
  editPromptBtn.disabled = !hasSelection;
  deletePromptBtn.disabled = !hasSelection;
}

function updatePromptCharacterCount(): void {
  promptCharCount.textContent = `${unicodeLength(promptInstructionInput.value)} / ${MAX_CUSTOM_PROMPT_INSTRUCTION_CHARS}`;
}

function closePromptEditor(): void {
  editingPromptId = null;
  promptEditor.hidden = true;
  promptError.textContent = "";
  promptNameInput.removeAttribute("aria-invalid");
  promptInstructionInput.removeAttribute("aria-invalid");
}

function openPromptEditor(profile?: CustomPromptProfile): void {
  editingPromptId = profile?.id ?? null;
  promptNameInput.value = profile?.name ?? "";
  promptInstructionInput.value = profile?.instruction ?? "";
  promptError.textContent = "";
  promptNameInput.removeAttribute("aria-invalid");
  promptInstructionInput.removeAttribute("aria-invalid");
  updatePromptCharacterCount();
  promptEditor.hidden = false;
  promptNameInput.focus();
}

function promptValidationMessage(error: CustomPromptValidationError): string {
  const keyByCode: Record<CustomPromptValidationError["code"], string> = {
    "name-required": "promptNameRequired",
    "name-too-long": "promptNameTooLong",
    "name-duplicate": "promptNameDuplicate",
    "instruction-required": "promptInstructionRequired",
    "instruction-too-long": "promptInstructionTooLong",
    "profile-limit": "promptProfileLimit",
  };
  return t(keyByCode[error.code], error.code === "name-too-long"
    ? String(MAX_CUSTOM_PROMPT_NAME_CHARS)
    : error.code === "instruction-too-long"
      ? String(MAX_CUSTOM_PROMPT_INSTRUCTION_CHARS)
      : error.code === "profile-limit"
        ? String(MAX_CUSTOM_PROMPT_PROFILES)
        : undefined);
}

function updateTranslationChunkHint(): void {
  const key = translationChunkPresetSelect.value === "fast"
    ? "translationChunkFastHint"
    : translationChunkPresetSelect.value === "context"
      ? "translationChunkContextHint"
      : "translationChunkBalancedHint";
  translationChunkHint.textContent = t(key);
}

// ── Populate model dropdown for a given provider ─────────────────────
function populateModels(providerId: string): void {
  modelSelect.innerHTML = "";
  const models = getModelsByProvider(providerId);
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name;
    modelSelect.appendChild(opt);
  }
}

// ── Update model info card ───────────────────────────────────────────
function updateModelInfo(): void {
  if (!currentModel) {
    infoParamSize.textContent = "—";
    infoContext.textContent = "—";
    infoDesc.textContent = "—";
    return;
  }
  infoParamSize.textContent = currentModel.paramSize;
  infoContext.textContent = formatContextWindow(currentModel.contextWindow);
  infoDesc.textContent = t(currentModel.descriptionKey);
}

function clearApiKeyError(): void {
  apiKeyError.textContent = "";
  apiKeyInput.removeAttribute("aria-invalid");
}

function showApiKeyRequiredError(): void {
  apiKeyError.textContent = t("apiKeyRequiredInline");
  apiKeyInput.setAttribute("aria-invalid", "true");
  apiKeyInput.focus();
}

function updateSetupUi(): void {
  const state = getApiKeyUiState(savedApiKey, apiKeyInput.value);
  const hasSavedKey = Boolean(savedApiKey);
  apiKeyState.className = `api-key-state is-${state}`;
  apiKeyState.textContent = t(
    state === "saved"
      ? "apiKeyStateSaved"
      : state === "modified"
        ? "apiKeyStateModified"
        : "apiKeyStateMissing",
  );
  setupGuide.hidden = hasSavedKey;
  setupComplete.hidden = !(setupJustCompleted && state === "saved");
  aiTabButton.classList.toggle("needs-setup", !hasSavedKey);
  if (hasSavedKey) aiTabButton.removeAttribute("aria-label");
  else aiTabButton.setAttribute("aria-label", t("aiTabNeedsSetup"));
  saveAiBtn.textContent = t(hasSavedKey ? "updateApiKey" : "saveApiKey");
}

function restorePersistedAISelection(): void {
  const selection = resolveAISelection(persistedProviderId, persistedModelId);
  currentProvider = selection.provider;
  currentModel = selection.model;
  providerSelect.value = currentProvider.id;
  populateModels(currentProvider.id);
  modelSelect.value = currentModel.id;
  updateModelInfo();
  updateApiKeyUI(currentProvider);
  void loadApiKeyForProvider(currentProvider.id);
}

async function persistAISelection(providerId: string, modelId: string): Promise<void> {
  const version = ++aiSelectionSaveVersion;
  try {
    await setSettings({ provider: providerId, model: modelId });
    if (
      version === aiSelectionSaveVersion &&
      providerSelect.value === providerId &&
      modelSelect.value === modelId
    ) {
      persistedProviderId = providerId;
      persistedModelId = modelId;
    }
  } catch (err) {
    if (version !== aiSelectionSaveVersion) return;
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.debug("[vas] AI selection save failed:", detail);
    restorePersistedAISelection();
    showStatus(t("saveFailed"), "error");
  }
}

// ── Update API Key UI for a given provider ───────────────────────────
function updateApiKeyUI(provider: ProviderInfo): void {
  apiKeyLabel.textContent = `${provider.name} API Key`;
  apiKeyLink.href = provider.docsUrl;
  apiKeyLink.textContent = t("openProviderApiKeyPage", provider.name);
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

uiLanguageSelect.addEventListener("change", async () => {
  const nextLanguage = uiLanguageSelect.value;
  if (!isUiLanguage(nextLanguage) || nextLanguage === activeUiLanguage) return;
  const previousLanguage = activeUiLanguage;
  uiLanguageSelect.disabled = true;
  try {
    const nextTranslator = await loadPopupTranslator(nextLanguage, chromeT);
    await setSettings({ uiLanguage: nextLanguage });
    activeUiLanguage = nextLanguage;
    t = nextTranslator;
    renderLocalizedUi();
    showStatus(t("settingsSaved"), "success");
  } catch (err) {
    uiLanguageSelect.value = previousLanguage;
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.debug("[vas] UI language change failed:", detail);
    showStatus(t("saveFailed"), "error");
  } finally {
    uiLanguageSelect.disabled = false;
  }
});

learningModeInput.addEventListener("change", () => {
  void saveAutomaticSettings({ learningModeEnabled: learningModeInput.checked });
});

bilingualDefaultInput.addEventListener("change", () => {
  void saveAutomaticSettings({
    bilingualSubtitlesDefaultEnabled: bilingualDefaultInput.checked,
  });
});

translationOnlyInput.addEventListener("change", () => {
  updateSubtitleModeAvailability();
  void saveAutomaticSettings({ translationOnlyEnabled: translationOnlyInput.checked });
});

for (const input of [
  sourceFontScaleInput,
  translationFontScaleInput,
  sourceColorInput,
  translationColorInput,
  backgroundOpacityInput,
  subtitleMaxWidthInput,
]) {
  input.addEventListener("input", updateSubtitleTypography);
  input.addEventListener("change", () => void saveSubtitleStyle());
}

customPromptSelect.addEventListener("change", () => {
  closePromptEditor();
  updateCustomPromptButtons();
  void saveAutomaticSettings({
    activeCustomPromptId: customPromptSelect.value || null,
  });
});

newPromptBtn.addEventListener("click", () => {
  if (customPromptProfiles.length < MAX_CUSTOM_PROMPT_PROFILES) openPromptEditor();
});

editPromptBtn.addEventListener("click", () => {
  const profile = customPromptProfiles.find((item) => item.id === customPromptSelect.value);
  if (profile) openPromptEditor(profile);
});

deletePromptBtn.addEventListener("click", async () => {
  const profile = customPromptProfiles.find((item) => item.id === customPromptSelect.value);
  if (!profile || !window.confirm(t("deletePromptConfirm", profile.name))) return;
  try {
    deletePromptBtn.disabled = true;
    await deleteCustomPromptProfile(profile.id);
    customPromptProfiles = await getCustomPromptProfiles();
    closePromptEditor();
    renderCustomPromptSelect(null);
    showStatus(t("promptDeleted"), "success");
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.debug("[vas] Custom prompt deletion failed:", detail);
    showStatus(t("saveFailed"), "error");
    updateCustomPromptButtons();
  }
});

promptNameInput.addEventListener("input", () => {
  promptNameInput.value = truncateUnicode(promptNameInput.value, MAX_CUSTOM_PROMPT_NAME_CHARS);
  promptNameInput.removeAttribute("aria-invalid");
  promptError.textContent = "";
});

promptInstructionInput.addEventListener("input", () => {
  promptInstructionInput.value = truncateUnicode(
    promptInstructionInput.value,
    MAX_CUSTOM_PROMPT_INSTRUCTION_CHARS,
  );
  promptInstructionInput.removeAttribute("aria-invalid");
  promptError.textContent = "";
  updatePromptCharacterCount();
});

cancelPromptBtn.addEventListener("click", closePromptEditor);

savePromptBtn.addEventListener("click", async () => {
  try {
    savePromptBtn.disabled = true;
    const profile = await saveCustomPromptProfile({
      id: editingPromptId ?? undefined,
      name: promptNameInput.value,
      instruction: promptInstructionInput.value,
    });
    await setSettings({ activeCustomPromptId: profile.id });
    customPromptProfiles = await getCustomPromptProfiles();
    closePromptEditor();
    renderCustomPromptSelect(profile.id);
    showStatus(t("promptSaved"), "success");
  } catch (err) {
    if (err instanceof CustomPromptValidationError) {
      promptError.textContent = promptValidationMessage(err);
      if (err.code.startsWith("name")) promptNameInput.setAttribute("aria-invalid", "true");
      if (err.code.startsWith("instruction")) {
        promptInstructionInput.setAttribute("aria-invalid", "true");
      }
    } else {
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.debug("[vas] Custom prompt save failed:", detail);
      promptError.textContent = t("saveFailed");
    }
  } finally {
    savePromptBtn.disabled = false;
  }
});

translationChunkPresetSelect.addEventListener("change", () => {
  updateTranslationChunkHint();
  void saveAutomaticSettings({
    translationChunkPreset: translationChunkPresetSelect.value as Settings["translationChunkPreset"],
  });
});

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

  // Provider/model choices are not secret and save immediately so opening the
  // external key console cannot lose the user's selection when the popup closes.
  if (firstModel) void persistAISelection(pid, firstModel.id);
  void loadApiKeyForProvider(pid);
});

// Model changed → update info card
modelSelect.addEventListener("change", () => {
  currentModel = getModelForProvider(providerSelect.value, modelSelect.value) ?? null;
  updateModelInfo();
  if (currentModel) void persistAISelection(providerSelect.value, currentModel.id);
});

apiKeyInput.addEventListener("input", () => {
  clearApiKeyError();
  setupJustCompleted = false;
  updateSetupUi();
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
  const key = normalizeRequiredApiKey(apiKeyInput.value);
  if (!key) {
    showApiKeyRequiredError();
    updateSetupUi();
    return;
  }
  try {
    const pid = providerSelect.value;
    const mid = modelSelect.value;

    if (!getModelForProvider(pid, mid)) {
      throw new Error(`Invalid provider/model selection: ${pid}/${mid}`);
    }

    saveAiBtn.disabled = true;
    await setSettings({
      provider: pid,
      model: mid,
    });
    await setApiKey(pid, key);
    persistedProviderId = pid;
    persistedModelId = mid;
    savedApiKey = key;
    apiKeyInput.value = key;
    setupJustCompleted = true;
    clearApiKeyError();
    updateSetupUi();
    logI18nDebug("popup settings saved", {
      chromeUiLocale: getUiLocale(),
      uiLanguage: activeUiLanguage,
      outputLanguage: outputLanguageSelect.value,
      providerId: pid,
      modelId: mid,
    });
    showStatus(t("apiKeySaved"), "success");
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.debug("[vas] Settings save failed:", detail);
    showStatus(t("saveFailed"), "error");
  } finally {
    saveAiBtn.disabled = false;
  }
});

clearKeysBtn.addEventListener("click", async () => {
  if (!window.confirm(t("clearAllApiKeysConfirm"))) return;
  try {
    apiKeyLoadVersion += 1;
    await clearAllApiKeys();
    apiKeyInput.value = "";
    savedApiKey = "";
    setupJustCompleted = false;
    clearApiKeyError();
    updateSetupUi();
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
