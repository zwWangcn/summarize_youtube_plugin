/**
 * 共享的内容脚本逻辑 — YouTube 和 Bilibili 入口共用。
 */

import { Panel, type TranscriptView } from "./ui/panel";
import {
  renderMarkdown,
  renderStreaming,
  renderTranscriptSections,
} from "./ui/renderer";
import {
  summarizeTextStream,
  getActiveAIIdentity,
} from "../service/ai";
import { formatTime } from "../utils/text";
import type { YouTubePlayer } from "./extractors/caption-interceptor";
import type { Transcript } from "./transcript";
import { isTranscriptInOutputLanguage, transcriptToText } from "./transcript";
import { UserError } from "../utils/errors";
import {
  translateTranscriptChunk,
  buildTranslationChunks,
  type TranslatedSegment,
  type TranslationChunk,
} from "../service/transcript-translation";
import {
  getCachedTranslation,
  setCachedTranslationSection,
  invalidateTranslationSection,
  type TranslationCacheIdentity,
} from "../service/translation-cache";
import {
  getCachedSummary,
  setCachedSummary,
  invalidateCache,
} from "../service/summary-cache";
import { handleError } from "./error-handler";
import { runSummaryCacheOperation } from "./summary-cache-operation";
import { getSettings } from "../service/storage";
import {
  isOutputLanguage,
  t,
  type OutputLanguage,
} from "../utils/i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Extractor {
  getTranscript: () => Promise<Transcript>;
  getVideoTitle: () => string;
  getVideoId: () => string;
  isOnVideoPage: () => boolean;
}

export interface ContentScriptConfig {
  source: string;
  enableTranslation?: boolean;
  enableLocalizedOutput?: boolean;
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
  if (secs < 60) return t("cacheJustNow");
  const mins = Math.floor(secs / 60);
  if (mins < 60) return t("cacheMinutesAgo", String(mins));
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("cacheHoursAgo", String(hours));
  const days = Math.floor(hours / 24);
  if (days < 30) return t("cacheDaysAgo", String(days));
  const months = Math.floor(days / 30);
  return t("cacheMonthsAgo", String(months));
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
// Main entry
// ---------------------------------------------------------------------------
export async function initContentScript(
  extractor: Extractor,
  config: ContentScriptConfig,
): Promise<void> {
  if (document.getElementById("vas-root")) return;

  let outputLanguage: OutputLanguage = "zh-CN";
  if (config.enableLocalizedOutput) {
    outputLanguage = (await getSettings()).outputLanguage;
  }

  // ── Shared state ───────────────────────────────────────────────────
  let transcriptData: Transcript | null = null;
  let transcriptVideoId = "";
  let transcriptChunks: TranslationChunk[] = [];
  let translatedSections: Record<number, TranslatedSegment[]> = {};
  let partialTranslatedSections: Record<number, TranslatedSegment[]> = {};
  let translationIdentityKey = "";
  let transcriptView: TranscriptView = "source";
  let activeChunkId = 0;
  let loadedChunkStart = 0;
  let loadedChunkEnd = 0;
  let transcriptWithTimestamps = true;
  let transcriptScrollTop = 0;
  let translationTask: Promise<void> | null = null;
  let translationAbort: AbortController | null = null;
  let summaryAbort: AbortController | null = null;
  let translationProgressText = "";
  let transcriptStateVersion = 0;
  let currentPanel: Panel | null = null;

  function clearTranscriptState(): void {
    transcriptStateVersion += 1;
    translationAbort?.abort();
    summaryAbort?.abort();
    summaryAbort = null;
    transcriptData = null;
    transcriptVideoId = "";
    transcriptChunks = [];
    translatedSections = {};
    partialTranslatedSections = {};
    translationIdentityKey = "";
    transcriptView = "source";
    translationTask = null;
    translationAbort = null;
    translationProgressText = "";
    transcriptScrollTop = 0;
  }

  if (config.enableLocalizedOutput) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      const next = changes.outputLanguage?.newValue;
      if (areaName !== "sync" || !isOutputLanguage(next) || next === outputLanguage) return;
      outputLanguage = next;
      clearTranscriptState();
      currentPanel?.reset();
      currentPanel?.setTranslationAvailable(Boolean(config.enableTranslation));
    });
  }

  async function ensureTranscript(
    panel: Panel,
    expectedVersion: number = transcriptStateVersion,
  ): Promise<Transcript> {
    const videoId = extractor.getVideoId();
    if (transcriptData && transcriptVideoId === videoId) return transcriptData;
    const transcript = await extractor.getTranscript();
    if (expectedVersion !== transcriptStateVersion) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    if (!transcript.segments.length) {
      throw new UserError(
        t("errorEmptyTranscript"),
        "EMPTY_TRANSCRIPT",
      );
    }
    transcriptData = transcript;
    transcriptVideoId = videoId;
    if (
      config.enableTranslation &&
      isTranscriptInOutputLanguage(transcript.languageCode, outputLanguage)
    ) {
      panel.setTranslationAvailable(false);
    }
    return transcript;
  }

  function getCurrentPlaybackTime(): number {
    const player = document.querySelector("#movie_player") as unknown as YouTubePlayer | null;
    const playerTime = player?.getCurrentTime?.();
    if (Number.isFinite(playerTime)) return playerTime!;
    return document.querySelector("video")?.currentTime ?? 0;
  }

  function findChunkAtTime(time: number): number {
    const found = transcriptChunks.findIndex((chunk) => {
      const first = transcriptData!.segments[chunk.targetStart];
      const last = transcriptData!.segments[chunk.targetEnd];
      return time >= first.start && time < last.start + last.duration;
    });
    if (found >= 0) return found;
    const next = transcriptChunks.findIndex(
      (chunk) => transcriptData!.segments[chunk.targetStart].start > time,
    );
    return next < 0 ? Math.max(0, transcriptChunks.length - 1) : next;
  }

  function updateTranscriptToolbar(panel: Panel): void {
    if (!transcriptData || !transcriptChunks.length) return;
    const chunk = transcriptChunks[activeChunkId];
    const first = transcriptData.segments[chunk.targetStart];
    const last = transcriptData.segments[chunk.targetEnd];
    panel.setTranscriptRange(
      t("sectionRange", [
        String(activeChunkId + 1),
        String(transcriptChunks.length),
        formatTime(first.start),
        formatTime(last.start + last.duration),
      ]),
    );
    panel.setCurrentSectionTranslated(Boolean(translatedSections[activeChunkId]));
    panel.setTranscriptView(transcriptView);
    panel.setTranslationProgress(translationProgressText);
  }

  function renderTranscriptReader(panel: Panel, preserveScroll: boolean = true): void {
    if (!transcriptData || !transcriptChunks.length) return;
    const content = panel.getContentElement();
    const previousTop = preserveScroll ? transcriptScrollTop : content.scrollTop;
    renderTranscriptSections(content, transcriptData, {
      chunks: transcriptChunks,
      loadedStart: loadedChunkStart,
      loadedEnd: loadedChunkEnd,
      activeChunkId,
      view: transcriptView,
      translations: translatedSections,
      partialTranslations: partialTranslatedSections,
      withTimestamps: transcriptWithTimestamps,
    });
    if (preserveScroll) content.scrollTop = previousTop;
    updateTranscriptToolbar(panel);
  }

  function updateActiveChunkFromScroll(panel: Panel): void {
    if (panel.getMode() !== "transcript") return;
    const content = panel.getContentElement();
    const center = content.getBoundingClientRect().top + content.clientHeight / 2;
    const sections = [...content.querySelectorAll<HTMLElement>(".vas-transcript-section")];
    if (!sections.length) return;
    const nearest = sections.reduce((best, section) => (
      Math.abs(section.getBoundingClientRect().top - center) <
      Math.abs(best.getBoundingClientRect().top - center) ? section : best
    ));
    const next = Number(nearest.dataset.chunkId);
    if (!Number.isInteger(next) || next === activeChunkId) return;
    activeChunkId = next;
    for (const section of sections) {
      section.classList.toggle("vas-current-section", Number(section.dataset.chunkId) === next);
    }
    updateTranscriptToolbar(panel);
  }

  function handleTranscriptScroll(panel: Panel): void {
    if (panel.getMode() !== "transcript" || !transcriptChunks.length) return;
    const content = panel.getContentElement();
    if (content.scrollTop < 80 && loadedChunkStart > 0) {
      const oldHeight = content.scrollHeight;
      loadedChunkStart -= 1;
      renderTranscriptReader(panel, false);
      content.scrollTop = content.scrollHeight - oldHeight + 80;
    } else if (
      content.scrollTop + content.clientHeight > content.scrollHeight - 80 &&
      loadedChunkEnd < transcriptChunks.length - 1
    ) {
      loadedChunkEnd += 1;
      renderTranscriptReader(panel, true);
    }
    updateActiveChunkFromScroll(panel);
    transcriptScrollTop = content.scrollTop;
  }

  async function ensureTranslationCache(
    expectedVersion: number = transcriptStateVersion,
  ): Promise<TranslationCacheIdentity> {
    const transcript = transcriptData!;
    const ai = await getActiveAIIdentity();
    const identity: TranslationCacheIdentity = {
      videoId: extractor.getVideoId(),
      sourceLanguage: transcript.languageCode,
      providerId: ai.providerId,
      modelId: ai.modelId,
      targetLanguage: outputLanguage,
    };
    const key = JSON.stringify(identity);
    if (translationIdentityKey !== key) {
      translatedSections = {};
      partialTranslatedSections = {};
      const cached = await getCachedTranslation(identity);
      if (expectedVersion !== transcriptStateVersion) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      for (const section of Object.values(cached?.sections ?? {})) {
        const chunk = transcriptChunks[section.chunkId];
        if (
          chunk &&
          chunk.targetStart === section.targetStart &&
          chunk.targetEnd === section.targetEnd
        ) {
          translatedSections[section.chunkId] = section.segments;
        }
      }
      translationIdentityKey = key;
    }
    return identity;
  }

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
      currentPanel.getContentElement().addEventListener(
        "scroll",
        () => handleTranscriptScroll(currentPanel!),
        { passive: true },
      );
      currentPanel.setTranslationAvailable(Boolean(config.enableTranslation));
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

  function runTranslationQueue(
    panel: Panel,
    requestedChunkIds: number[],
    forceRefresh: boolean,
    isFullTranslation: boolean,
  ): void {
    if (translationTask || !transcriptData) return;
    const transcript = transcriptData;
    const stateVersion = transcriptStateVersion;
    const controller = new AbortController();
    translationAbort = controller;
    const assertCurrent = () => {
      if (controller.signal.aborted || stateVersion !== transcriptStateVersion) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
    };
    panel.setTranslationActionsBusy(true);
    if (!isFullTranslation) {
      transcriptView = "translation";
      panel.setTranscriptView("translation");
    }

    const task = (async () => {
      const identity = await ensureTranslationCache(stateVersion);
      assertCurrent();
      if (forceRefresh && requestedChunkIds.length === 1) {
        const chunkId = requestedChunkIds[0];
        await invalidateTranslationSection(identity, chunkId);
        assertCurrent();
        delete translatedSections[chunkId];
      }
      const pending = requestedChunkIds.filter(
        (chunkId) => forceRefresh || !translatedSections[chunkId],
      );
      if (!pending.length) {
        translationProgressText = t(
          isFullTranslation ? "translationAllAlreadyDone" : "translationSectionAlreadyDone",
        );
        return;
      }

      for (let index = 0; index < pending.length; index++) {
        assertCurrent();
        const chunkId = pending[index];
        const chunk = transcriptChunks[chunkId];
        translationProgressText = isFullTranslation
          ? t("translatingAllProgress", [
            String(Object.keys(translatedSections).length),
            String(transcriptChunks.length),
          ])
          : t("translatingSectionProgress", [
            String(chunkId + 1),
            String(transcriptChunks.length),
          ]);
        panel.setTranslationProgress(translationProgressText);

        const result = await translateTranscriptChunk(
          transcript,
          chunk,
          identity.targetLanguage,
          (partial, formatRetry) => {
            if (controller.signal.aborted || stateVersion !== transcriptStateVersion) return;
            partialTranslatedSections[chunkId] = partial;
            translationProgressText = formatRetry
              ? t("repairingSectionFormat", String(chunkId + 1))
              : translationProgressText;
            if (panel.getMode() === "transcript") renderTranscriptReader(panel);
          },
          controller.signal,
        );
        assertCurrent();
        delete partialTranslatedSections[chunkId];
        translatedSections[chunkId] = result;
        try {
          await setCachedTranslationSection(identity, {
            chunkId,
            targetStart: chunk.targetStart,
            targetEnd: chunk.targetEnd,
            segments: result,
          });
          assertCurrent();
        } catch (error) {
          assertCurrent();
          const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
          console.debug("[vas] Translation section cache write failed:", detail);
          panel.showWarning(t("translationCacheWriteFailed"));
        }
        if (panel.getMode() === "transcript") renderTranscriptReader(panel);
      }
      translationProgressText = t(
        isFullTranslation ? "translationAllDone" : "translationSectionDone",
      );
    })().catch((error: unknown) => {
      if ((error as Error)?.name === "AbortError") return;
      const message = error instanceof Error ? error.message : t("translationFailed");
      translationProgressText = t("translationStopped", message);
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.debug("[vas] Translation stopped:", detail);
      if (panel.getMode() === "transcript") panel.showWarning(message);
    }).finally(() => {
      if (stateVersion !== transcriptStateVersion || translationTask !== task) return;
      translationTask = null;
      translationAbort = null;
      panel.setTranslationActionsBusy(false);
      panel.setTranslationProgress(translationProgressText);
      if (panel.getMode() === "transcript") renderTranscriptReader(panel);
    });
    translationTask = task;
  }

  // ── Callbacks ──────────────────────────────────────────────────────
  const callbacks = {
    onSummarize: async () => {
      const panel = getPanel();
      const requestedLanguage = outputLanguage;
      summaryAbort?.abort();
      const summaryController = new AbortController();
      summaryAbort = summaryController;
      let renderFrameId: number | null = null;
      const assertCurrent = () => {
        if (
          summaryController.signal.aborted ||
          summaryAbort !== summaryController ||
          requestedLanguage !== outputLanguage
        ) {
          throw new DOMException("The operation was aborted", "AbortError");
        }
      };
      let cacheFailed = false;
      const reportCacheFailure = () => {
        cacheFailed = true;
      };

      try {
        const videoId = extractor.getVideoId();
        const videoTitle = extractor.getVideoTitle();

        // 如果已经显示缓存内容，用户点击「再次总结」——强制刷新
        const isForceRefresh = panel.getIsCachedView();

        if (isForceRefresh) {
          await runSummaryCacheOperation(
            "invalidation",
            () => invalidateCache(config.source, videoId, requestedLanguage),
            reportCacheFailure,
          );
          assertCurrent();
          panel.setCachedView(false);
          panel.setSummarizeButtonText(t("aiSummary"));
          panel.hideCacheHint();
        }

        // ── 非强制刷新时先检查缓存 ──
        if (!isForceRefresh) {
          const cached = await runSummaryCacheOperation(
            "read",
            () => getCachedSummary(config.source, videoId, requestedLanguage),
            reportCacheFailure,
          );
          assertCurrent();
          if (cached) {
            // 缓存命中——直接显示
            panel.setTitle(videoTitle || cached.videoTitle);
            panel.setContent(renderMarkdown(cached.text));
            panel.setMode("summary");
            panel.setCachedView(true);
            panel.setSummarizeButtonText(t("summarizeAgain"));

            // 显示缓存时间
            const elapsed = Date.now() - cached.timestamp;
            const hint = formatCacheAge(elapsed);
            panel.showCacheHint(t("cachedAt", hint));
            panel.open();
            return;
          }
        }

        // ── 缓存未命中或强制刷新——走 API ──
        panel.setMode("loading");
        panel.setLoadingMessage(t("fetchingTranscript"));
        panel.setCachedView(false);
        panel.open();

        const transcript = await ensureTranscript(panel);
        assertCurrent();
        const transcriptText = transcriptToText(transcript);

        panel.setTitle(videoTitle);
        panel.setLoadingMessage(t("generatingSummary"));

        // 切换到流式内容展示——显示「AI 正在思考...」指示器，等首批 token 到达后替换
        panel.beginStreaming();

        // 流式渲染：使用 rAF 节流确保浏览器有机会 paint，避免假 stream
        const contentEl = panel.getContentElement();
        let buffer = "";
        let pendingRender = false;

        for await (const chunk of summarizeTextStream(
          transcriptText,
          config.source,
          requestedLanguage,
          summaryController.signal,
        )) {
          buffer += chunk;
          if (!pendingRender) {
            pendingRender = true;
            renderFrameId = requestAnimationFrame(() => {
              if (!summaryController.signal.aborted && summaryAbort === summaryController) {
                renderStreaming(contentEl, buffer);
              }
              pendingRender = false;
            });
          }
        }
        assertCurrent();

        // flush 最后一次渲染
        if (renderFrameId !== null) cancelAnimationFrame(renderFrameId);
        renderFrameId = null;
        renderStreaming(contentEl, buffer);

        // 保存到缓存
        if (buffer.trim()) {
          await runSummaryCacheOperation(
            "write",
            () => setCachedSummary(
              config.source,
              videoId,
              videoTitle,
              buffer,
              requestedLanguage,
            ),
            reportCacheFailure,
          );
          assertCurrent();
        }

        panel.setMode("summary");
        // API 获取的新内容，标记为可「再次总结」
        panel.setCachedView(true);
        panel.setSummarizeButtonText(t("summarizeAgain"));
        if (cacheFailed) {
          panel.showWarning(t("summaryCacheUnavailable"));
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        handleError(err, panel);
      } finally {
        if (renderFrameId !== null) cancelAnimationFrame(renderFrameId);
        if (summaryAbort === summaryController) summaryAbort = null;
      }
    },

    onTranscript: async (withTimestamps: boolean) => {
      const panel = getPanel();
      const stateVersion = transcriptStateVersion;
      panel.setMode("loading");
      panel.setLoadingMessage(t("fetchingTranscript"));
      panel.open();

      try {
        const transcript = await ensureTranscript(panel, stateVersion);
        panel.setTitle(extractor.getVideoTitle());
        transcriptWithTimestamps = withTimestamps;
        const isInitialOpen = !transcriptChunks.length;
        if (isInitialOpen) {
          transcriptChunks = buildTranslationChunks(transcript.segments);
          activeChunkId = findChunkAtTime(getCurrentPlaybackTime());
          loadedChunkStart = Math.max(0, activeChunkId - 1);
          loadedChunkEnd = Math.min(transcriptChunks.length - 1, activeChunkId + 1);
          if (
            config.enableTranslation &&
            !isTranscriptInOutputLanguage(transcript.languageCode, outputLanguage)
          ) {
            await ensureTranslationCache();
          }
        }
        panel.setMode("transcript");
        panel.setTranslationAvailable(
          Boolean(config.enableTranslation) &&
          !isTranscriptInOutputLanguage(transcript.languageCode, outputLanguage),
        );
        panel.setTranslationActionsBusy(Boolean(translationTask));
        renderTranscriptReader(panel, !isInitialOpen);
        if (isInitialOpen) {
          requestAnimationFrame(() => {
            if (stateVersion !== transcriptStateVersion) return;
            const active = panel.getContentElement().querySelector<HTMLElement>(
              `[data-chunk-id="${activeChunkId}"]`,
            );
            if (active) {
              panel.getContentElement().scrollTop = Math.max(0, active.offsetTop - 12);
            }
          });
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        handleError(err, panel);
      }
    },

    onTranscriptViewChange: config.enableTranslation
      ? (view: TranscriptView) => {
          transcriptView = view;
          renderTranscriptReader(getPanel());
        }
      : undefined,

    onTranslateCurrent: config.enableTranslation
      ? (forceRefresh: boolean) => {
          runTranslationQueue(getPanel(), [activeChunkId], forceRefresh, false);
        }
      : undefined,

    onTranslateAll: config.enableTranslation
      ? () => {
          runTranslationQueue(
            getPanel(),
            transcriptChunks.map((chunk) => chunk.id),
            false,
            true,
          );
        }
      : undefined,

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
      console.debug("[vas] Player target not found, using body fallback");
      target = document.body;
    }

    currentPanel = new Panel(callbacks);
    currentPanel.getContentElement().addEventListener(
      "scroll",
      () => handleTranscriptScroll(currentPanel!),
      { passive: true },
    );
    currentPanel.setTranslationAvailable(Boolean(config.enableTranslation));
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
    clearTranscriptState();
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
          p.setTranslationAvailable(Boolean(config.enableTranslation));
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
