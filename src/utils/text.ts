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

/** 去除时间戳行，将字幕文本拼接为段落。 */
export function stripTimestamps(transcript: string): string {
  const lines = transcript.trim().split("\n");
  const textLines: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Skip timestamp lines (M:SS, MM:SS, H:MM:SS, or HH:MM:SS)
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(line)) continue;
    textLines.push(line);
  }
  if (!textLines.length) return "";

  // Join into paragraphs at natural sentence boundaries
  const sentenceEnds = new Set(["。", "！", "？", ".", "!", "?", "…", "‥"]);
  const result: string[] = [];
  const buffer: string[] = [];
  for (const seg of textLines) {
    buffer.push(seg);
    if (seg && sentenceEnds.has(seg[seg.length - 1])) {
      result.push(buffer.join(""));
      buffer.length = 0;
    }
  }
  if (buffer.length) result.push(buffer.join(""));
  return result.join("\n\n");
}

/**
 * 格式化原始字幕（timestamp \n text 配对）用于展示。
 * withTimestamps=true → [HH:MM:SS] text
 * withTimestamps=false → 无时间戳的段落文本
 */
export function formatTranscript(transcript: string, withTimestamps: boolean): string {
  if (!withTimestamps) return stripTimestamps(transcript);

  const lines = transcript.trim().split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const ts = lines[i].trim();
    const text = i + 1 < lines.length ? lines[i + 1].trim() : "";
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(ts)) {
      out.push(`[${ts}] ${text}`);
      i += 2;
    } else {
      if (ts) out.push(ts);
      i += 1;
    }
  }
  return out.join("\n");
}
