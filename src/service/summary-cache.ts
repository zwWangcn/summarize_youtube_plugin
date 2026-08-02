/**
 * 总结缓存模块 — 使用 chrome.storage.local 持久化 AI 总结结果。
 *
 * 设计要点：
 *   - 存储后端：chrome.storage.local（约 10MB 配额）
 *   - TTL：默认 7 天，过期自动淘汰
 *   - 容量控制：最多 50 条，超出按 LRU 淘汰最旧条目
 *   - 所有数据存于单一 key "vas-summaries" 下，避免 key 数量膨胀
 */

import type { OutputLanguage } from "../utils/i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CachedSummary {
  text: string; // Markdown 格式的总结内容
  videoTitle: string; // 视频标题（用于 UI 展示）
  videoId: string; // 视频 ID
  source: string; // Cache namespace, currently "youtube"
  outputLanguage: OutputLanguage; // AI 输出语言
  timestamp: number; // 缓存时间 (Date.now())
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STORAGE_KEY = "vas-summaries";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const MAX_CACHE_ENTRIES = 50;

type CacheIndex = Record<string, CachedSummary>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
async function readIndex(): Promise<CacheIndex> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as CacheIndex) ?? {};
}

async function writeIndex(index: CacheIndex): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: index });
}

/** 构造缓存 key：source:videoId:outputLanguage */
function makeKey(source: string, videoId: string, outputLanguage: OutputLanguage): string {
  return `${source}:${videoId}:${outputLanguage}`;
}

function makeLegacyKey(source: string, videoId: string): string {
  return `${source}:${videoId}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 读取缓存的总结。
 * 如果缓存不存在或已过期，返回 null。
 */
export async function getCachedSummary(
  source: string,
  videoId: string,
  outputLanguage: OutputLanguage,
): Promise<CachedSummary | null> {
  const index = await readIndex();
  const key = makeKey(source, videoId, outputLanguage);
  let entry = index[key];
  const legacyKey = makeLegacyKey(source, videoId);
  if (!entry && outputLanguage === "zh-CN" && index[legacyKey]) {
    entry = { ...index[legacyKey], outputLanguage: "zh-CN" };
    index[key] = entry;
    delete index[legacyKey];
    await writeIndex(index);
  }
  if (!entry) return null;

  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    // 惰性清理过期条目
    delete index[key];
    await writeIndex(index);
    return null;
  }
  return entry;
}

/**
 * 写入总结缓存。
 * 写入前自动清理过期条目，超出上限时淘汰最旧条目（LRU）。
 */
export async function setCachedSummary(
  source: string,
  videoId: string,
  videoTitle: string,
  text: string,
  outputLanguage: OutputLanguage,
): Promise<void> {
  const index = await readIndex();

  // 1. 清理过期条目
  const now = Date.now();
  for (const k of Object.keys(index)) {
    if (now - index[k].timestamp > CACHE_TTL_MS) {
      delete index[k];
    }
  }

  // 2. 检查容量，按 LRU 淘汰最旧的
  const keys = Object.keys(index);
  if (keys.length >= MAX_CACHE_ENTRIES) {
    // 按 timestamp 升序排列，最旧的在前面
    const sorted = keys.sort((a, b) => index[a].timestamp - index[b].timestamp);
    // 需要腾出多少个槽位
    const toRemove = sorted.slice(0, keys.length - MAX_CACHE_ENTRIES + 1);
    for (const k of toRemove) {
      delete index[k];
    }
  }

  // 3. 写入新条目
  const key = makeKey(source, videoId, outputLanguage);
  index[key] = {
    text,
    videoTitle,
    videoId,
    source,
    outputLanguage,
    timestamp: now,
  };

  await writeIndex(index);
}

/**
 * 删除指定视频的缓存（用于「再次总结」强制刷新）。
 */
export async function invalidateCache(
  source: string,
  videoId: string,
  outputLanguage: OutputLanguage,
): Promise<void> {
  const index = await readIndex();
  const key = makeKey(source, videoId, outputLanguage);
  delete index[key];
  if (outputLanguage === "zh-CN") delete index[makeLegacyKey(source, videoId)];
  await writeIndex(index);
}

/**
 * 清空所有过期的缓存条目。
 * 可在扩展启动时调用，做一次全局清理。
 */
export async function clearExpiredCache(): Promise<void> {
  const index = await readIndex();
  const now = Date.now();
  let changed = false;
  for (const k of Object.keys(index)) {
    if (now - index[k].timestamp > CACHE_TTL_MS) {
      delete index[k];
      changed = true;
    }
  }
  if (changed) {
    await writeIndex(index);
  }
}
