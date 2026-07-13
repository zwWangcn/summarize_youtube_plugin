/**
 * YouTube 字幕提取器。
 *
 * 从页面中的 ytInitialPlayerResponse 提取字幕轨道信息，
 * 然后 fetch XML 字幕并解析为 [MM:SS] text 格式。
 */

import { formatTime } from "../../utils/text";
import { UserError } from "../../utils/errors";
import { getCaptionedText } from "./caption-interceptor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CaptionTrack {
  baseUrl: string;
  name: { simpleText: string };
  vssId: string;
  languageCode: string;
  kind?: string;
}

export interface VideoInfo {
  title: string;
  videoId: string;
  captionTracks: CaptionTrack[];
}

// ---------------------------------------------------------------------------
// Language priority
// ---------------------------------------------------------------------------
export const LANG_PRIORITY = ["ja", "en", "zh-Hans", "zh-HK", "zh-TW", "zh"];

// ---------------------------------------------------------------------------
// Extract ytInitialPlayerResponse from page
// ---------------------------------------------------------------------------
function extractPlayerResponse(): Record<string, unknown> | null {
  // Method 1: try window.ytInitialPlayerResponse
  const w = window as unknown as Record<string, unknown>;
  if (w.ytInitialPlayerResponse) {
    return w.ytInitialPlayerResponse as Record<string, unknown>;
  }

  // Method 2: parse from <script> tags
  const scripts = document.querySelectorAll("script");
  for (const script of scripts) {
    const text = script.textContent ?? "";
    const match = text.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        continue;
      }
    }
    // Also try window.ytInitialPlayerResponse = {...}
    const match2 = text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
    if (match2) {
      try {
        return JSON.parse(match2[1]);
      } catch {
        continue;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parse captions
// ---------------------------------------------------------------------------
function parseCaptionTracks(playerResponse: Record<string, unknown>): CaptionTrack[] {
  const captions = playerResponse?.captions as Record<string, unknown> | undefined;
  const renderer = captions?.playerCaptionsTracklistRenderer as Record<string, unknown> | undefined;
  const tracks = (renderer?.captionTracks as CaptionTrack[]) ?? [];
  return tracks;
}

function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (!tracks.length) return null;

  const byLang = new Map<string, CaptionTrack>();
  for (const t of tracks) {
    if (t.baseUrl && !byLang.has(t.languageCode)) {
      byLang.set(t.languageCode, t);
    }
  }

  for (const lang of LANG_PRIORITY) {
    const match = byLang.get(lang);
    if (match) return match;
  }
  // Fallback: first track with a URL
  return tracks.find((t) => t.baseUrl) ?? null;
}

// ---------------------------------------------------------------------------
// Fetch and parse XML captions
// ---------------------------------------------------------------------------
async function fetchAndParseCaptions(baseUrl: string): Promise<string> {
  let url = baseUrl.startsWith("https://") ? baseUrl : `https://www.youtube.com${baseUrl}`;

  // Strip "variant" parameter (e.g., variant=gemini) — it can cause empty
  // responses.  The variant key is NOT in sparams, so removing it does not
  // invalidate the URL signature.
  try {
    const u = new URL(url);
    if (u.searchParams.has("variant")) { u.searchParams.delete("variant"); }
    if (u.searchParams.has("fmt"))     { u.searchParams.delete("fmt"); }
    url = u.toString();
  } catch {
    // If URL parsing fails, fall back to regex stripping
    url = url.replace(/&variant=[^&]*/g, "").replace(/\?variant=[^&]*(&|$)/, "?");
    url = url.replace(/&fmt=[^&]*/g,     "").replace(/\?fmt=[^&]*(&|$)/,     "?");
  }

  const resp = await fetch(url);

  if (!resp.ok) {
    throw new UserError(
      "字幕加载失败，请刷新页面后重试",
      "YT_CAPTION_FETCH",
      `HTTP ${resp.status}`,
    );
  }

  const xmlText = await resp.text();

  if (!xmlText || !xmlText.trim()) {
    throw new UserError(
      "该视频暂无可用字幕，请尝试在播放器中手动开启字幕（CC 按钮）",
      "YT_EMPTY_RESPONSE",
    );
  }

  return parseTimedText(xmlText);
}

function parseTimedText(xml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  const texts = doc.querySelectorAll("text");
  const lines: string[] = [];
  for (const el of texts) {
    const start = parseFloat(el.getAttribute("start") ?? "0");
    const dur = parseFloat(el.getAttribute("dur") ?? "0");
    // YouTube timedtext: content may be in child elements or raw text
    let content = "";
    for (const child of el.children) {
      content += child.textContent ?? "";
    }
    if (!content) {
      content = el.textContent ?? "";
    }
    content = decodeHtmlEntities(content.trim());
    if (content) {
      lines.push(`${formatTime(start)}\n${content}`);
    }
    // Include duration for better timing display
    void dur; // reserved for future use
  }
  return lines.join("\n");
}

function decodeHtmlEntities(text: string): string {
  const txt = document.createElement("textarea");
  txt.innerHTML = text;
  return txt.value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 提取 INNERTUBE_API_KEY。
 * 尝试多种方式，兼容 YouTube 页面不同的加载状态。
 */
function getApiKey(): string {
  // 方法 1：ytcfg.get()（页面正常加载时可用）
  try {
    const w = window as unknown as { ytcfg?: { get?: (key: string) => unknown; data_?: Record<string, unknown> } };
    const key = w.ytcfg?.get?.("INNERTUBE_API_KEY") as string | undefined;
    if (key) return key;
  } catch { /* continue */ }

  // 方法 2：ytcfg.data_（某些 YouTube 版本）
  try {
    const w = window as unknown as { ytcfg?: { data_?: Record<string, unknown> } };
    const key = w.ytcfg?.data_?.INNERTUBE_API_KEY as string | undefined;
    if (key) return key;
  } catch { /* continue */ }

  // 方法 3：正则提取页面 HTML（youtube-transcript-api 的做法，兼容性最强）
  try {
    const match = document.documentElement.outerHTML.match(
      /"INNERTUBE_API_KEY"\s*:\s*"([a-zA-Z0-9_-]+)"/
    );
    if (match?.[1]) return match[1];
  } catch { /* continue */ }

  return "";
}

/**
 * 通过 InnerTube ANDROID 客户端获取字幕 —— 参考 youtube-transcript-api 方案。
 *
 * YouTube WEB 客户端的 timedtext 请求需要 POT (Proof of Origin Token)，
 * 但 ANDROID 客户端不受此限制。此方法：
 *   1. POST youtubei/v1/player（ANDROID 上下文）→ 获取带有效签名的 baseUrl
 *   2. GET baseUrl → 返回 XML timedtext → 解析
 *
 * 这是目前最可靠的静默字幕获取方式，无需 CC 按钮、拦截器或播放器操作。
 */
async function fetchCaptionsViaInnerTube(
  _preferredLangs: string[],
): Promise<string> {
  const apiKey = getApiKey();
  const videoId = getVideoIdFromUrl();
  if (!apiKey || !videoId) throw new UserError("页面尚未加载完成，请刷新后重试", "YT_NO_API_KEY");

  const resp = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": "en-US",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "20.10.38",
          },
        },
        videoId,
      }),
    },
  );

  if (!resp.ok) throw new UserError("字幕服务暂时不可用，正在尝试其他方式…", "YT_INNERTUBE", `HTTP ${resp.status}`);
  const data = await resp.json();

  const tracks =
    (data?.captions?.playerCaptionsTracklistRenderer
      ?.captionTracks as CaptionTrack[]) ?? [];

  if (!tracks.length) throw new UserError("该视频未提供字幕", "YT_NO_CAPTIONS");

  const track = pickCaptionTrack(tracks);
  if (!track) {
    const available = tracks.map((t) => t.languageCode).join(", ");
    throw new UserError("该视频暂无中/英/日文字幕", "YT_NO_PREF_LANG", `available: ${available}`);
  }
  return fetchAndParseCaptions(track.baseUrl);
}

/** 获取当前页面的视频字幕文本。 */
export async function getTranscript(): Promise<string> {
  // 1. 快速路径：拦截器缓存（如果 CC 已开启，播放器会自然请求）
  try {
    const cached = await getCaptionedText(getVideoIdFromUrl(), LANG_PRIORITY, 3000);
    if (cached) return cached;
  } catch {
    // 缓存未命中，继续主路径
  }

  // 2. 主路径：InnerTube ANDROID（最可靠，静默）
  try {
    return await fetchCaptionsViaInnerTube(LANG_PRIORITY);
  } catch (e) {
    console.warn("[vas] InnerTube 失败，回退到直接 fetch:", e instanceof Error ? e.message : e);
  }

  // 3. 最终回退：直接 fetch ytInitialPlayerResponse 中的 baseUrl
  const info = getVideoInfo();
  if (!info) throw new UserError("请在 YouTube 视频页面使用此功能", "YT_NOT_VIDEO");
  if (!info.captionTracks.length) throw new UserError("该视频未提供字幕", "YT_NO_CAPTIONS");

  const track = pickCaptionTrack(info.captionTracks);
  if (!track) {
    const available = info.captionTracks.map((t) => t.languageCode).join(", ");
    throw new UserError("该视频暂无中/英/日文字幕", "YT_NO_PREF_LANG", `available: ${available}`);
  }

  return fetchAndParseCaptions(track.baseUrl);
}

/** 从当前 YouTube 页面提取视频信息（标题 + 字幕轨道）。 */
export function getVideoInfo(): VideoInfo | null {
  const playerResponse = extractPlayerResponse();
  if (!playerResponse) return null;

  const videoId = extractVideoId(playerResponse);
  const title = extractTitle(playerResponse);
  const captionTracks = parseCaptionTracks(playerResponse);

  return { title, videoId, captionTracks };
}

/** 从各种来源提取视频 ID。 */
export function getVideoIdFromUrl(): string {
  return extractVideoId(extractPlayerResponse());
}

/** 获取当前页面的视频标题（含多重回退）。 */
export function getVideoTitle(): string {
  return extractTitle(extractPlayerResponse());
}

/** 检测当前页面是否为 YouTube 视频页。 */
export function isYouTubeVideoPage(): boolean {
  return window.location.pathname === "/watch";
}

// ---------------------------------------------------------------------------
// Internal helpers (used by public API above)
// ---------------------------------------------------------------------------

function extractVideoId(playerResponse: Record<string, unknown> | null): string {
  if (playerResponse) {
    const vd = playerResponse.videoDetails as Record<string, unknown> | undefined;
    const id = vd?.videoId as string | undefined;
    if (id) return id;
  }
  const url = new URL(window.location.href);
  return url.searchParams.get("v") ?? "";
}

function extractTitle(playerResponse: Record<string, unknown> | null): string {
  if (playerResponse) {
    const vd = playerResponse.videoDetails as Record<string, unknown> | undefined;
    const title = vd?.title as string | undefined;
    if (title) return title;
  }
  const dt = document.title || "";
  return dt.replace(/\s*-\s*YouTube\s*$/, "").trim() || "未知标题";
}
