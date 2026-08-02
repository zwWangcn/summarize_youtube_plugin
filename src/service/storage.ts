/**
 * Chrome Storage 封装。
 *
 * 普通设置使用 storage.sync；API Key 只保存在当前设备的 storage.local。
 */

import {
  getInitialOutputLanguage,
  isOutputLanguage,
  type OutputLanguage,
} from "../utils/i18n";

export interface Settings {
  /** 当前选中的供应商 */
  provider: string;
  /** 当前选中的模型 */
  model: string;
  /** YouTube 总结和字幕翻译的目标语言 */
  outputLanguage: OutputLanguage;
}

const DEFAULTS: Omit<Settings, "outputLanguage"> = {
  provider: "deepseek",
  model: "deepseek-v4-flash",
};

const API_KEYS_KEY = "apiKeys";
const V1_MIGRATION_KEY = "vas-settings-migrated-v2";
const LOCAL_KEYS_MIGRATION_KEY = "vas-api-keys-migrated-v3";

let migrationPromise: Promise<void> | null = null;

function normalizeApiKeys(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Record<string, string> = {};
  for (const [provider, key] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key === "string" && key.trim()) normalized[provider] = key.trim();
  }
  return normalized;
}

/** 将旧版 storage.sync 中的 API Key 一次性迁移到当前设备。 */
async function migrateApiKeysToLocal(): Promise<void> {
  const local = await chrome.storage.local.get({
    [API_KEYS_KEY]: {},
    [LOCAL_KEYS_MIGRATION_KEY]: false,
  });
  if (local[LOCAL_KEYS_MIGRATION_KEY]) return;

  const synced = await chrome.storage.sync.get({
    [API_KEYS_KEY]: {},
    deepseekApiKey: "",
  });
  const legacyDeepSeekKey = typeof synced.deepseekApiKey === "string"
    ? synced.deepseekApiKey.trim()
    : "";
  const merged = {
    ...(legacyDeepSeekKey ? { deepseek: legacyDeepSeekKey } : {}),
    ...normalizeApiKeys(synced[API_KEYS_KEY]),
    ...normalizeApiKeys(local[API_KEYS_KEY]),
  };

  await chrome.storage.local.set({
    [API_KEYS_KEY]: merged,
  });
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
  });
  if (!isOutputLanguage(result.outputLanguage)) {
    result.outputLanguage = getInitialOutputLanguage();
    await chrome.storage.sync.set({ outputLanguage: result.outputLanguage });
  }
  return result as Settings;
}

export async function setSettings(partial: Partial<Settings>): Promise<void> {
  await ensureMigrations();
  await chrome.storage.sync.set(partial);
}

export async function getApiKeys(): Promise<Record<string, string>> {
  await ensureMigrations();
  const result = await chrome.storage.local.get(API_KEYS_KEY);
  return normalizeApiKeys(result[API_KEYS_KEY]);
}

export async function getApiKey(provider: string): Promise<string> {
  return (await getApiKeys())[provider] ?? "";
}

export async function setApiKey(provider: string, key: string): Promise<void> {
  await ensureMigrations();
  const result = await chrome.storage.local.get(API_KEYS_KEY);
  const apiKeys = normalizeApiKeys(result[API_KEYS_KEY]);
  const normalizedKey = key.trim();
  if (normalizedKey) apiKeys[provider] = normalizedKey;
  else delete apiKeys[provider];
  await chrome.storage.local.set({ [API_KEYS_KEY]: apiKeys });
}

export async function clearAllApiKeys(): Promise<void> {
  await ensureMigrations();
  await chrome.storage.local.remove(API_KEYS_KEY);
}

export async function hasAnyApiKey(): Promise<boolean> {
  return Object.keys(await getApiKeys()).length > 0;
}
