/**
 * Chrome Storage 封装。
 *
 * 普通设置使用 storage.sync；API Key 只保存在当前设备的 storage.local。
 */

import {
  getInitialOutputLanguage,
  getInitialUiLanguage,
  isOutputLanguage,
  isUiLanguage,
  type OutputLanguage,
  type UiLanguage,
} from "../utils/i18n";
import {
  DEFAULT_SUBTITLE_STYLE,
  normalizeSubtitleStyle,
  type SubtitleStyleSettings,
} from "./subtitle-style";
import {
  CustomPromptValidationError,
  DEFAULT_TRANSLATION_CHUNK_PRESET,
  MAX_CUSTOM_PROMPT_INSTRUCTION_CHARS,
  MAX_CUSTOM_PROMPT_NAME_CHARS,
  MAX_CUSTOM_PROMPT_PROFILES,
  normalizeCustomPromptProfile,
  normalizeTranslationChunkPreset,
  unicodeLength,
  type CustomPromptProfile,
  type TranslationChunkPreset,
} from "./ai-controls";

export interface Settings {
  /** 当前选中的供应商 */
  provider: string;
  /** 当前选中的模型 */
  model: string;
  /** YouTube 总结和字幕翻译的目标语言 */
  outputLanguage: OutputLanguage;
  /** 扩展自身界面使用的固定语言，不影响总结和字幕翻译语言。 */
  uiLanguage: UiLanguage;
  /** 学习模式下仅在悬停字幕时显示译文。 */
  learningModeEnabled: boolean;
  /** 隐藏原文并持续显示译文；启用时学习模式暂不生效。 */
  translationOnlyEnabled: boolean;
  /** 新视频是否默认启用播放器双语字幕。 */
  bilingualSubtitlesDefaultEnabled: boolean;
  /** 播放器双语字幕的同步样式设置。 */
  subtitleStyle: SubtitleStyleSettings;
  /** 当前启用的自定义 AI 提示词；null 表示不使用。 */
  activeCustomPromptId: string | null;
  /** 字幕翻译请求的目标分块大小。 */
  translationChunkPreset: TranslationChunkPreset;
}

const DEFAULTS: Omit<Settings, "outputLanguage" | "uiLanguage"> = {
  provider: "deepseek",
  model: "deepseek-flash",
  learningModeEnabled: false,
  translationOnlyEnabled: false,
  bilingualSubtitlesDefaultEnabled: true,
  subtitleStyle: DEFAULT_SUBTITLE_STYLE,
  activeCustomPromptId: null,
  translationChunkPreset: DEFAULT_TRANSLATION_CHUNK_PRESET,
};

const API_KEYS_KEY = "apiKeys";
const API_KEY_PREFIX = "vas-api-key:";
const V1_MIGRATION_KEY = "vas-settings-migrated-v2";
const LOCAL_KEYS_MIGRATION_KEY = "vas-api-keys-migrated-v4";
export const CUSTOM_PROMPT_STORAGE_PREFIX = "vas-custom-prompt:";
const CUSTOM_PROMPT_ORDER_KEY = "vas-custom-prompt-order";
let migrationPromise: Promise<void> | null = null;

function normalizeApiKeys(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Record<string, string> = {};
  for (const [provider, key] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key === "string" && key.trim()) normalized[provider] = key.trim();
  }
  return normalized;
}

function apiKeyStorageKey(provider: string): string {
  return `${API_KEY_PREFIX}${encodeURIComponent(provider)}`;
}

function readPerProviderKeys(store: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [storageKey, value] of Object.entries(store)) {
    if (!storageKey.startsWith(API_KEY_PREFIX) || typeof value !== "string" || !value.trim()) {
      continue;
    }
    try {
      result[decodeURIComponent(storageKey.slice(API_KEY_PREFIX.length))] = value.trim();
    } catch {
      // Ignore malformed keys from unrelated/old extension versions.
    }
  }
  return result;
}

/** 将旧版 storage.sync 中的 API Key 一次性迁移到当前设备。 */
async function migrateApiKeysToLocal(): Promise<void> {
  const initialLocal = await chrome.storage.local.get(LOCAL_KEYS_MIGRATION_KEY);
  if (initialLocal[LOCAL_KEYS_MIGRATION_KEY]) return;

  const synced = await chrome.storage.sync.get({
    [API_KEYS_KEY]: {},
    deepseekApiKey: "",
  });
  const legacyDeepSeekKey = typeof synced.deepseekApiKey === "string"
    ? synced.deepseekApiKey.trim()
    : "";
  // sync 读取期间其他扩展上下文可能已经完成迁移，因此写入前必须重新读取 local。
  const latestLocal = await chrome.storage.local.get(null);
  if (latestLocal[LOCAL_KEYS_MIGRATION_KEY]) return;
  const merged = {
    ...(legacyDeepSeekKey ? { deepseek: legacyDeepSeekKey } : {}),
    ...normalizeApiKeys(synced[API_KEYS_KEY]),
    ...normalizeApiKeys(latestLocal[API_KEYS_KEY]),
    ...readPerProviderKeys(latestLocal),
  };

  const perProviderUpdates = Object.fromEntries(
    Object.entries(merged).map(([provider, key]) => [apiKeyStorageKey(provider), key]),
  );
  if (Object.keys(perProviderUpdates).length) {
    await chrome.storage.local.set(perProviderUpdates);
  }
  await chrome.storage.local.remove(API_KEYS_KEY);
  await chrome.storage.sync.remove([API_KEYS_KEY, "deepseekApiKey"]);
  await chrome.storage.sync.set({ [V1_MIGRATION_KEY]: true });
  await chrome.storage.local.set({ [LOCAL_KEYS_MIGRATION_KEY]: true });
}

async function ensureMigrations(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      await migrateApiKeysToLocal();
    })().catch((error) => {
      migrationPromise = null;
      throw error;
    });
  }
  await migrationPromise;
}

export async function getSettings(): Promise<Settings> {
  await ensureMigrations();
  const result = await chrome.storage.sync.get({
    ...DEFAULTS,
    outputLanguage: null,
    uiLanguage: null,
  });
  const initializedSettings: Partial<Settings> = {};
  if (!isOutputLanguage(result.outputLanguage)) {
    result.outputLanguage = getInitialOutputLanguage();
    initializedSettings.outputLanguage = result.outputLanguage;
  }
  if (!isUiLanguage(result.uiLanguage)) {
    result.uiLanguage = getInitialUiLanguage();
    initializedSettings.uiLanguage = result.uiLanguage;
  }
  if (Object.keys(initializedSettings).length) {
    await chrome.storage.sync.set(initializedSettings);
  }
  return {
    ...result,
    subtitleStyle: normalizeSubtitleStyle(result.subtitleStyle),
    activeCustomPromptId: typeof result.activeCustomPromptId === "string" &&
        result.activeCustomPromptId.trim()
      ? result.activeCustomPromptId.trim()
      : null,
    translationChunkPreset: normalizeTranslationChunkPreset(result.translationChunkPreset),
  } as Settings;
}

export async function setSettings(partial: Partial<Settings>): Promise<void> {
  await ensureMigrations();
  await chrome.storage.sync.set({
    ...partial,
    ...(partial.subtitleStyle === undefined
      ? {}
      : { subtitleStyle: normalizeSubtitleStyle(partial.subtitleStyle) }),
  });
}

export async function getApiKeys(): Promise<Record<string, string>> {
  await ensureMigrations();
  const result = await chrome.storage.local.get(null);
  return readPerProviderKeys(result);
}

export async function getApiKey(provider: string): Promise<string> {
  await ensureMigrations();
  const storageKey = apiKeyStorageKey(provider);
  const result = await chrome.storage.local.get(storageKey);
  const value = result[storageKey];
  return typeof value === "string" ? value.trim() : "";
}

export async function setApiKey(provider: string, key: string): Promise<void> {
  await ensureMigrations();
  const storageKey = apiKeyStorageKey(provider);
  const normalizedKey = key.trim();
  if (normalizedKey) await chrome.storage.local.set({ [storageKey]: normalizedKey });
  else await chrome.storage.local.remove(storageKey);
}

export async function clearAllApiKeys(): Promise<void> {
  await ensureMigrations();
  const stored = await chrome.storage.local.get(null);
  const keys = Object.keys(stored).filter(
    (key) => key.startsWith(API_KEY_PREFIX) || key === API_KEYS_KEY,
  );
  if (keys.length) await chrome.storage.local.remove(keys);
}

export async function hasAnyApiKey(): Promise<boolean> {
  return Object.keys(await getApiKeys()).length > 0;
}

function customPromptStorageKey(id: string): string {
  return `${CUSTOM_PROMPT_STORAGE_PREFIX}${id}`;
}

function normalizePromptOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && Boolean(id)))]
    .slice(0, MAX_CUSTOM_PROMPT_PROFILES);
}

function createCustomPromptId(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function getCustomPromptProfiles(): Promise<CustomPromptProfile[]> {
  const indexResult = await chrome.storage.sync.get(CUSTOM_PROMPT_ORDER_KEY);
  const order = normalizePromptOrder(indexResult[CUSTOM_PROMPT_ORDER_KEY]);
  if (!order.length) return [];
  const keys = order.map(customPromptStorageKey);
  const stored = await chrome.storage.sync.get(keys);
  const profiles: CustomPromptProfile[] = [];
  for (const id of order) {
    const profile = normalizeCustomPromptProfile(stored[customPromptStorageKey(id)]);
    if (profile && profile.id === id) profiles.push(profile);
  }
  return profiles;
}

export async function getCustomPromptProfile(
  id: string | null | undefined,
): Promise<CustomPromptProfile | null> {
  if (!id) return null;
  const key = customPromptStorageKey(id);
  const stored = await chrome.storage.sync.get(key);
  const profile = normalizeCustomPromptProfile(stored[key]);
  return profile?.id === id ? profile : null;
}

export async function saveCustomPromptProfile(input: {
  id?: string;
  name: string;
  instruction: string;
}): Promise<CustomPromptProfile> {
  const name = input.name.trim();
  const instruction = input.instruction.trim();
  if (!name) throw new CustomPromptValidationError("name-required");
  if (unicodeLength(name) > MAX_CUSTOM_PROMPT_NAME_CHARS) {
    throw new CustomPromptValidationError("name-too-long");
  }
  if (!instruction) throw new CustomPromptValidationError("instruction-required");
  if (unicodeLength(instruction) > MAX_CUSTOM_PROMPT_INSTRUCTION_CHARS) {
    throw new CustomPromptValidationError("instruction-too-long");
  }

  const profiles = await getCustomPromptProfiles();
  const existing = input.id ? profiles.find((profile) => profile.id === input.id) : undefined;
  if (!existing && profiles.length >= MAX_CUSTOM_PROMPT_PROFILES) {
    throw new CustomPromptValidationError("profile-limit");
  }
  if (profiles.some((profile) => (
    profile.id !== input.id && profile.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0
  ))) {
    throw new CustomPromptValidationError("name-duplicate");
  }

  const id = existing?.id ?? createCustomPromptId();
  const profile = { id, name, instruction };
  const order = existing ? profiles.map((item) => item.id) : [...profiles.map((item) => item.id), id];
  await chrome.storage.sync.set({
    [customPromptStorageKey(id)]: profile,
    [CUSTOM_PROMPT_ORDER_KEY]: order,
  });
  return profile;
}

export async function deleteCustomPromptProfile(id: string): Promise<void> {
  const profiles = await getCustomPromptProfiles();
  const nextOrder = profiles.filter((profile) => profile.id !== id).map((profile) => profile.id);
  const settings = await getSettings();
  await chrome.storage.sync.set({
    [CUSTOM_PROMPT_ORDER_KEY]: nextOrder,
    ...(settings.activeCustomPromptId === id ? { activeCustomPromptId: null } : {}),
  });
  await chrome.storage.sync.remove(customPromptStorageKey(id));
}
