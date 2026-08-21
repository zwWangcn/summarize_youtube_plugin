/**
 * 文本工具函数 — 从 Python text_utils.py 直译。
 */

/** 格式化秒数为 H:MM:SS 或 MM:SS。 */
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 将时间戳字符串解析为总秒数。formatTime 的逆运算。
 * 支持 M:SS / MM:SS（分钟可超过 59）/ H:M:SS / HH:MM:SS，
 * 冒号兼容全角「：」。
 * 无法解析时返回 null。
 */
export function parseTimestampToSeconds(ts: string): number | null {
  const parts = ts.replace(/：/g, ":").split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (!parts.every((part) => /^\d+$/.test(part))) return null;
  const nums = parts.map(Number);
  // 秒必须两位。小时格式容忍 AI
  // 偶尔输出的 H:M:SS（例如 1:2:03），后续的范围校验仍会拒绝非法分钟。
  if (parts.at(-1)?.length !== 2) return null;
  const [h, m, s] = parts.length === 3 ? nums : [0, ...nums];
  // 两段式中 m 是“总分钟”，因此 76:20 合法；三段式中才要求分钟 < 60。
  if ((parts.length === 3 && m >= 60) || s >= 60) return null;
  return h * 3600 + m * 60 + s;
}
