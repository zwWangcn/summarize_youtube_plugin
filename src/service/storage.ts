/**
 * Chrome Storage 封装 — 管理多供应商 API Key 和用户设置。
 */

export interface Settings {
  /** 各供应商的 API Key，key 为 provider id（如 "openai"、"deepseek"） */
  apiKeys: Record<string, string>;
  /** 当前选中的供应商 */
  provider: string;
  /** 当前选中的模型 */
  model: string;
}

const DEFAULTS: Settings = {
  apiKeys: {},
  provider: "deepseek",
  model: "deepseek-v4-flash",
};

// ---------------------------------------------------------------------------
// 向后兼容迁移：v1 deepseekApiKey → v2 apiKeys.deepseek
// ---------------------------------------------------------------------------
const MIGRATION_KEY = "vas-settings-migrated-v2";

async function migrateFromV1(): Promise<void> {
  try {
    const alreadyDone = await chrome.storage.sync.get(MIGRATION_KEY);
    if (alreadyDone[MIGRATION_KEY]) return;

    // 读取旧格式
    const old = await chrome.storage.sync.get({
      deepseekApiKey: "",
      model: "deepseek-v4-flash",
    });

    const apiKeys: Record<string, string> = {};
    if (old.deepseekApiKey) {
      apiKeys["deepseek"] = old.deepseekApiKey;
    }

    await chrome.storage.sync.set({
      apiKeys,
      provider: "deepseek",
      model: old.model,
      [MIGRATION_KEY]: true,
    });

    // 清理旧 key（可选，不影响旧版本）
    await chrome.storage.sync.remove("deepseekApiKey");
  } catch {
    // 静默失败，不阻塞正常使用
  }
}

// 首次使用时惰性执行迁移（在 getSettings 中调用）

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<Settings> {
  // Ensure v1 → v2 migration has completed before reading
  await migrateFromV1();

  const result = await chrome.storage.sync.get(DEFAULTS);
  // 确保 apiKeys 始终是对象（旧迁移可能不完整）
  if (!result.apiKeys || typeof result.apiKeys !== "object") {
    result.apiKeys = {};
  }
  return result as Settings;
}

export async function setSettings(partial: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(partial);
}

/** 获取指定供应商的 API Key */
export async function getApiKey(provider: string): Promise<string> {
  const settings = await getSettings();
  return settings.apiKeys[provider] ?? "";
}

/** 检查指定供应商是否已配置 API Key */
export async function hasApiKey(provider: string): Promise<boolean> {
  const key = await getApiKey(provider);
  return key.length > 0;
}
