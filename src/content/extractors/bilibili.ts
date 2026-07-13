/**
 * Bilibili 字幕提取器。
 *
 * 从 __INITIAL_STATE__ 获取视频信息，调用 Bilibili 字幕 API，
 * 浏览器自动携带 cookies，无需手动 SESSDATA。
 */

import { formatTime } from "../../utils/text";
import { UserError } from "../../utils/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface BilibiliInitialState {
  aid?: number;
  bvid?: string;
  cid?: number;
  videoData?: {
    aid?: number;
    bvid?: string;
    cid?: number;
    title?: string;
  };
}

interface SubtitleItem {
  id: number;
  lan: string;
  lan_doc: string;
  subtitle_url: string;
  is_lock: boolean;
}

interface SubtitleSegment {
  from: number;
  to: number;
  content: string;
}

// ---------------------------------------------------------------------------
// Language priority (same as Python)
// ---------------------------------------------------------------------------
const LANG_PRIORITY = ["zh-Hans", "zh-CN", "zh", "ai-zh", "en", "en-US"];

// ---------------------------------------------------------------------------
// Extract __INITIAL_STATE__
// ---------------------------------------------------------------------------
function getInitialState(): BilibiliInitialState | null {
  const w = window as unknown as Record<string, unknown>;
  const state = w.__INITIAL_STATE__ as BilibiliInitialState | undefined;
  return state ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** 从 __INITIAL_STATE__ 获取视频基本信息。 */
export function getVideoInfo(): { aid: number; bvid: string; cid: number; title: string } | null {
  const state = getInitialState();
  if (!state) return null;

  const aid = state.aid ?? state.videoData?.aid ?? 0;
  const bvid = state.bvid ?? state.videoData?.bvid ?? "";
  const cid = state.cid ?? state.videoData?.cid ?? 0;
  const title = state.videoData?.title ?? document.title.replace(/_哔哩哔哩_bilibili$/, "") ?? "";

  if (!bvid || !cid) return null;
  return { aid, bvid, cid, title };
}

/** 从 Bilibili API 获取字幕列表。 */
async function fetchSubtitles(bvid: string, cid: number): Promise<SubtitleItem[]> {
  const url = `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`;
  const resp = await fetch(url, { credentials: "include" });
  if (!resp.ok) throw new UserError("Bilibili 接口请求失败，请稍后重试", "BL_API_FAIL", `HTTP ${resp.status}`);

  const data = await resp.json();
  if (data.code !== 0) {
    const code = data.code as number;
    if ([-101, -403, 87007].includes(code)) {
      throw new UserError("需要登录 Bilibili 才能获取字幕，请在浏览器中登录后重试", "BL_LOGIN", `code=${code}`);
    }
    throw new UserError("获取字幕信息失败，请稍后重试", "BL_API_ERR", `code=${code} msg=${data.message ?? "unknown"}`);
  }

  const subtitles: SubtitleItem[] = data.data?.subtitle?.subtitles ?? [];
  return subtitles;
}

/** 获取字幕正文。 */
async function fetchSubtitleBody(subtitleUrl: string): Promise<SubtitleSegment[]> {
  const url = subtitleUrl.startsWith("//") ? `https:${subtitleUrl}` : subtitleUrl;
  const resp = await fetch(url);
  if (!resp.ok) throw new UserError("字幕文件加载失败，请稍后重试", "BL_SUB_FETCH", `HTTP ${resp.status}`);
  const data = await resp.json();
  return (data.body as SubtitleSegment[]) ?? [];
}

/** 按语言优先级选择合适的字幕。 */
function pickSubtitle(subtitles: SubtitleItem[]): SubtitleItem | null {
  if (!subtitles.length) return null;

  const byLan = new Map<string, SubtitleItem>();
  for (const s of subtitles) {
    if (s.subtitle_url && !byLan.has(s.lan)) {
      byLan.set(s.lan, s);
    }
  }

  for (const lang of LANG_PRIORITY) {
    const match = byLan.get(lang);
    if (match) return match;
  }

  // Fallback: first subtitle with a URL
  return subtitles.find((s) => s.subtitle_url) ?? null;
}

/** 获取当前页面的 Bilibili 视频字幕文本。 */
export async function getTranscript(): Promise<string> {
  const info = getVideoInfo();
  if (!info) throw new UserError("请在 Bilibili 视频页面使用此功能", "BL_NOT_VIDEO");

  const subtitles = await fetchSubtitles(info.bvid, info.cid);
  if (!subtitles.length) throw new UserError("该视频未提供字幕", "BL_NO_SUBS");

  const chosen = pickSubtitle(subtitles);
  if (!chosen) {
    const available = subtitles.map((s) => s.lan).join(", ");
    throw new UserError("该视频暂无中/英文字幕", "BL_NO_PREF_LANG", `available: ${available}`);
  }

  const body = await fetchSubtitleBody(chosen.subtitle_url);
  if (!body.length) throw new UserError("字幕内容为空，可能是格式不支持", "BL_EMPTY");

  const lines = body.map(
    (seg) => `${formatTime(seg.from)}\n${seg.content}`,
  );
  return lines.join("\n");
}

/** 获取当前页面的视频标题。 */
export function getVideoTitle(): string {
  const info = getVideoInfo();
  return info?.title || document.title || "未知标题";
}

/** 检测当前页面是否为 Bilibili 视频页。 */
export function isBilibiliVideoPage(): boolean {
  return (
    window.location.hostname.includes("bilibili.com") &&
    window.location.pathname.startsWith("/video/")
  );
}
