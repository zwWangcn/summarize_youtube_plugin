/**
 * 共享的内容脚本逻辑 — YouTube 和 Bilibili 入口共用。
 */

import { Panel } from "./ui/panel";
import { renderMarkdown, renderStreaming, renderTranscript } from "./ui/renderer";
import { summarizeTextStream, AIServiceError, ContentFilteredError, NoApiKeyError } from "../service/ai";
import { formatTranscript } from "../utils/text";
import type { YouTubePlayer } from "./extractors/caption-interceptor";
import { UserError } from "../utils/errors";
import {
  getCachedSummary,
  setCachedSummary,
  invalidateCache,
} from "../service/summary-cache";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Extractor {
  getTranscript: () => Promise<string>;
  getVideoTitle: () => string;
  getVideoId: () => string;
  isOnVideoPage: () => boolean;
}

export interface ContentScriptConfig {
  source: string;
  /** Find injection target — used on initial load + SPA rebuilds */
  findInjectTarget: () => HTMLElement | null;
}

// ---------------------------------------------------------------------------
// Injection targets
// ---------------------------------------------------------------------------

/** YouTube: find injection target — video player container (stable, rarely re-rendered) */
export function findYouTubeTarget(): HTMLElement | null {
  const selectors = [
    "#movie_player",           // ✅ 视频播放器容器（最稳定）
    "#player-container",       // fallback
    "#player",                 // fallback
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) continue;
    if (el.classList.contains("skeleton-bg-color")) continue;
    if (el.closest(".watch-skeleton")) continue;
    return el;
  }
  return null;
}

/** Bilibili: try multiple selectors */
export function findBilibiliTarget(): HTMLElement | null {
  const selectors = [
    ".video-title",
    ".video-info-title",
    "h1[data-title]",
    ".video-info-container",
    "#bilibiliPlayer",
    ".bpx-player-container",
    "#playerWrap",
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el as HTMLElement;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wait for an element to appear (YouTube/Bilibili render async after load)
// ---------------------------------------------------------------------------
function waitForTarget(
  findFn: () => HTMLElement | null,
  timeoutMs: number = 15000,
): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    // Fast path: already present
    const existing = findFn();
    if (existing) {
      resolve(existing);
      return;
    }

    // Watch DOM mutations
    const observer = new MutationObserver(() => {
      const el = findFn();
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Timeout fallback: poll every 500ms
    const pollInterval = setInterval(() => {
      const el = findFn();
      if (el) {
        clearInterval(pollInterval);
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    }, 500);

    const timer = setTimeout(() => {
      observer.disconnect();
      clearInterval(pollInterval);
      reject(new Error("Timeout waiting for injection target"));
    }, timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// Theme detection
// ---------------------------------------------------------------------------
function isYouTubeDarkMode(): boolean {
  const root = document.documentElement;
  return root.hasAttribute("dark") || root.classList.contains("yt-dark-mode");
}

/** 将毫秒时间差转为人类可读的相对时间。 */
function formatCacheAge(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return "刚刚";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  return `${months} 个月前`;
}

// ---------------------------------------------------------------------------
// SPA navigation detection
// ---------------------------------------------------------------------------
function watchNavigation(onChange: () => void): () => void {
  let lastUrl = window.location.href;

  // Watch <title> mutations
  const titleObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      onChange();
    }
  });
  const titleEl = document.querySelector("title");
  if (titleEl) titleObserver.observe(titleEl, { childList: true, subtree: true });

  // Intercept history API
  const origPushState = history.pushState.bind(history);
  const origReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args: Parameters<typeof origPushState>) {
    origPushState(...args);
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      onChange();
    }
  };
  history.replaceState = function (...args: Parameters<typeof origReplaceState>) {
    origReplaceState(...args);
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      onChange();
    }
  };
  window.addEventListener("popstate", onPopState);
  function onPopState() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      onChange();
    }
  }

  return () => {
    titleObserver.disconnect();
    history.pushState = origPushState;
    history.replaceState = origReplaceState;
    window.removeEventListener("popstate", onPopState);
  };
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/**
 * 统一的错误处理：用户看到友好的中文提示，技术细节仅输出到 Console。
 */
function handleError(err: unknown, panel: Panel): void {
  if (err instanceof UserError) {
    panel.showError(err.message);
    console.warn(`[vas] ${err.code}:`, err.detail ?? err.message);
  } else if (err instanceof AIServiceError || err instanceof ContentFilteredError || err instanceof NoApiKeyError) {
    panel.showError(err.message);
    console.warn("[vas] AI error:", err.message);
  } else {
    panel.showError("出了点问题，请稍后重试");
    console.error("[vas] Unexpected error:", err);
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
export async function initContentScript(
  extractor: Extractor,
  config: ContentScriptConfig,
): Promise<void> {
  if (document.getElementById("vas-root")) return;

  // ── Shared state ───────────────────────────────────────────────────
  let transcriptText = "";
  let currentPanel: Panel | null = null;

  function getPanel(): Panel {
    if (!currentPanel || !document.getElementById("vas-root")) {
      // 旧 Panel 可能因宿主页重建 DOM 而脱离文档（vas-root 丢失）。
      // 直接覆盖会泄漏其 bindToPlayer 事件监听器与残留 trigger DOM，故先销毁。
      if (currentPanel) {
        currentPanel.destroy();
        currentPanel = null;
      }
      const newTarget = config.findInjectTarget() || document.body;
      currentPanel = new Panel(callbacks);
      const t = extractor.getVideoTitle();
      if (t) currentPanel.setTitle(t);
      currentPanel.setTheme(isYouTubeDarkMode());
      currentPanel.injectTrigger(newTarget);
      currentPanel.bindToPlayer(newTarget);
      currentPanel.injectPanel(document.body);
      currentPanel.initPanelWidth();
    }
    return currentPanel!;
  }

  // ── Callbacks ──────────────────────────────────────────────────────
  const callbacks = {
    onSummarize: async () => {
      const panel = getPanel();
      const videoId = extractor.getVideoId();
      const videoTitle = extractor.getVideoTitle();

      // 如果已经显示缓存内容，用户点击「再次总结」——强制刷新
      const isForceRefresh = panel.getIsCachedView();

      if (isForceRefresh) {
        // 删除旧缓存
        await invalidateCache(config.source, videoId);
        panel.setCachedView(false);
        panel.setSummarizeButtonText("AI 总结");
        panel.hideCacheHint();
      }

      // ── 非强制刷新时先检查缓存 ──
      if (!isForceRefresh) {
        const cached = await getCachedSummary(config.source, videoId);
        if (cached) {
          // 缓存命中——直接显示
          panel.setTitle(videoTitle || cached.videoTitle);
          panel.setContent(renderMarkdown(cached.text));
          panel.setMode("summary");
          panel.setCachedView(true);
          panel.setSummarizeButtonText("再次总结");

          // 显示缓存时间
          const elapsed = Date.now() - cached.timestamp;
          const hint = formatCacheAge(elapsed);
          panel.showCacheHint(`缓存于 ${hint}`);
          panel.open();
          return;
        }
      }

      // ── 缓存未命中或强制刷新——走 API ──
      panel.setMode("loading");
      panel.setLoadingMessage("正在获取字幕...");
      panel.setCachedView(false);
      panel.open();

      try {
        transcriptText = await extractor.getTranscript();

        if (!transcriptText || !transcriptText.trim()) {
          throw new UserError(
            "未能提取到有效字幕文本，请确认该视频有字幕且语言可识别",
            "EMPTY_TRANSCRIPT",
          );
        }

        panel.setTitle(videoTitle);
        panel.setLoadingMessage("AI 正在生成总结...");

        // 切换到流式内容展示——显示「AI 正在思考...」指示器，等首批 token 到达后替换
        panel.beginStreaming();

        // 流式渲染：使用 rAF 节流确保浏览器有机会 paint，避免假 stream
        const contentEl = panel.getContentElement();
        let buffer = "";
        let rafId: number | null = null;
        let pendingRender = false;

        for await (const chunk of summarizeTextStream(transcriptText, config.source)) {
          buffer += chunk;
          if (!pendingRender) {
            pendingRender = true;
            rafId = requestAnimationFrame(() => {
              renderStreaming(contentEl, buffer);
              pendingRender = false;
            });
          }
        }

        // flush 最后一次渲染
        if (rafId !== null) cancelAnimationFrame(rafId);
        renderStreaming(contentEl, buffer);

        // 保存到缓存
        if (buffer.trim()) {
          await setCachedSummary(config.source, videoId, videoTitle, buffer);
        }

        panel.setMode("summary");
        // API 获取的新内容，标记为可「再次总结」
        panel.setCachedView(true);
        panel.setSummarizeButtonText("再次总结");
      } catch (err) {
        handleError(err, panel);
      }
    },

    onTranscript: async (withTimestamps: boolean) => {
      const panel = getPanel();
      panel.setMode("loading");
      panel.setLoadingMessage("正在获取字幕...");
      panel.open();

      try {
        transcriptText = await extractor.getTranscript();

        if (!transcriptText || !transcriptText.trim()) {
          throw new UserError(
            "未能提取到有效字幕文本，请确认该视频有字幕且语言可识别",
            "EMPTY_TRANSCRIPT",
          );
        }

        panel.setTitle(extractor.getVideoTitle());
        const formatted = formatTranscript(transcriptText, withTimestamps);
        renderTranscript(panel.getContentElement(), formatted);
        panel.setMode("transcript");
      } catch (err) {
        handleError(err, panel);
      }
    },

    onClose: () => {},

    onSeek: (seconds: number) => {
      // 优先用 YouTube 播放器 API（同视频 SPA 内 seek，无网络请求）；
      // 回退到直接操作 <video>（Bilibili 及 player API 不可用时）。
      const player = document.querySelector("#movie_player") as unknown as YouTubePlayer | null;
      if (player?.seekTo) {
        player.seekTo(seconds, true);
        player.playVideo?.();
        return;
      }
      const video = document.querySelector("video") as HTMLVideoElement | null;
      if (video) {
        video.currentTime = seconds;
        void video.play();
      }
    },
  };

  // ── Inject panel on video page ─────────────────────────────────────
  async function injectOnVideoPage(): Promise<void> {
    if (!extractor.isOnVideoPage()) return;
    if (document.getElementById("vas-root")) return;

    // 走到这里说明 vas-root 已不在文档中（被宿主页移除）。
    // 若 currentPanel 仍持有旧实例，先销毁以释放事件监听器与残留 DOM，避免泄漏。
    if (currentPanel) {
      currentPanel.destroy();
      currentPanel = null;
    }

    let target: HTMLElement;
    try {
      target = await waitForTarget(config.findInjectTarget, 30000);
    } catch {
      console.warn("[vas] Player target not found, using body fallback");
      target = document.body;
    }

    currentPanel = new Panel(callbacks);
    const videoTitle = extractor.getVideoTitle();
    if (videoTitle) currentPanel.setTitle(videoTitle);
    currentPanel.setTheme(isYouTubeDarkMode());

    // 注入触发按钮到播放器
    currentPanel.injectTrigger(target);
    // 绑定到播放器 hover 状态 — 跟随原生控制栏自动显隐
    currentPanel.bindToPlayer(target);
    // 注入面板到 body（position: fixed，不受父元素影响）
    currentPanel.injectPanel(document.body);
    currentPanel.initPanelWidth();
  }

  function destroyPanel(): void {
    currentPanel?.destroy();
    currentPanel = null;
  }

  // ── Try initial injection ──────────────────────────────────────────
  await injectOnVideoPage();

  // ── Recovery: YouTube swap skeleton → real DOM may destroy #vas-root ──
  // 在 1s、3s、6s 后检查是否被移除，必要时重新注入
  [1000, 3000, 6000].forEach((delay) => {
    setTimeout(() => {
      if (!extractor.isOnVideoPage()) return;

      const vasRoot = document.getElementById("vas-root");
      const triggerInDom = currentPanel?.getTrigger()?.parentNode;

      if (!vasRoot || !triggerInDom) {
        console.log(`[vas] UI missing after ${delay}ms (root=${!!vasRoot}, trigger=${!!triggerInDom}), re-injecting...`);
        injectOnVideoPage();
      }
    }, delay);
  });

  // ── SPA navigation: inject on enter, destroy on leave ──────────────
  watchNavigation(() => {
    if (extractor.isOnVideoPage()) {
      // Entered a video page (or navigated to a new video)
      if (!document.getElementById("vas-root")) {
        // Fresh entry — wait for DOM, then inject
        setTimeout(async () => {
          destroyPanel();
          await injectOnVideoPage();
        }, 800);
      } else {
        // Panel exists — reset for the new video
        setTimeout(() => {
          const p = getPanel();
          p.reset();
          const t = extractor.getVideoTitle();
          if (t) p.setTitle(t);
          p.setTheme(isYouTubeDarkMode());

          // Re-inject trigger if YouTube rebuilt the player
          if (!p.getTrigger().parentNode) {
            const newTarget = config.findInjectTarget() || document.body;
            p.injectTrigger(newTarget);
            p.bindToPlayer(newTarget);
          }
        }, 800);
      }
    } else {
      // Left the video page
      destroyPanel();
    }
  });
}
