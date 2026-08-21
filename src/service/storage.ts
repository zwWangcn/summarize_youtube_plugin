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

export interface Settings {
  /** 当前选中的供应商 */
  provider: string;
  /** 当前选中的模型 */
  model: string;
  /** YouTube 总结和字幕翻译的目标语言 */
  outputLanguage: OutputLanguage;
  /** 扩展设置弹窗使用的固定界面语言。 */
  uiLanguage: UiLanguage;
  /** 学习模式下仅在悬停字幕时显示译文。 */
  learningModeEnabled: boolean;
  /** 隐藏原文并持续显示译文；启用时学习模式暂不生效。 */
  translationOnlyEnabled: boolean;
  /** 新视频是否默认启用播放器双语字幕。 */
  bilingualSubtitlesDefaultEnabled: boolean;
  /** 播放器双语字幕的同步样式设置。 */
  subtitleStyle: SubtitleStyleSettings;
}

const DEFAULTS: Omit<Settings, "outputLanguage" | "uiLanguage"> = {
  provider: "deepseek",
  model: "deepseek-v4-flash",
  learningModeEnabled: false,
  translationOnlyEnabled: false,
  bilingualSubtitlesDefaultEnabled: true,
  subtitleStyle: DEFAULT_SUBTITLE_STYLE,
};

const API_KEYS_KEY = "apiKeys";
const API_KEY_PREFIX = "vas-api-key:";
const V1_MIGRATION_KEY = "vas-settings-migrated-v2";
const LOCAL_KEYS_MIGRATION_KEY = "vas-api-keys-migrated-v4";
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
