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
 * 支持 M:SS / MM:SS / H:MM:SS / HH:MM:SS，冒号兼容全角「：」。
 * 无法解析时返回 null。
 */
export function parseTimestampToSeconds(ts: string): number | null {
  const parts = ts.replace(/：/g, ":").split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  // 秒、分必须两位；小时可一位。防止把普通数字误判为时间戳。
  if (parts[1].length !== 2) return null;
  if (parts.length === 3 && parts[2].length !== 2) return null;
  const [h, m, s] = parts.length === 3 ? nums : [0, ...nums];
  if (m >= 60 || s >= 60) return null;
  return h * 3600 + m * 60 + s;
}
