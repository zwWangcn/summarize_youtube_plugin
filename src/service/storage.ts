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
