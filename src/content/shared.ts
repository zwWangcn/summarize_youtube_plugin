/** YouTube 内容脚本的 UI、字幕、翻译和 SPA 生命周期编排。 */

import { Panel, type TranscriptView } from "./ui/panel";
import { BilingualSubtitleOverlay } from "./ui/bilingual-overlay";
import {
  renderMarkdown,
  renderStreaming,
  renderTranscriptSections,
} from "./ui/renderer";
import {
  summarizeTextStream,
  getActiveAIIdentity,
  translateSummaryStream,
} from "../service/ai-client";
import { formatTime } from "../utils/text";
import type { Transcript } from "./transcript";
import {
  buildAlignedTranscript,
  findActiveCueIndex,
  getCaptionPrefetchRange,
  isTranscriptInOutputLanguage,
  transcriptToText,
} from "./transcript";
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
import { getSettings, setSettings } from "../service/storage";
import {
  getOutputLanguageInfo,
  getUiLocale,
  isOutputLanguage,
  t,
  type OutputLanguage,
} from "../utils/i18n";
import { analyzeTextScripts, logI18nDebug } from "../utils/i18n-debug";
import {
  detectOutputLanguage,
  type OutputLanguageStatus,
} from "../utils/output-language-detection";

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
  /** Find injection target — used on initial load + SPA rebuilds */
  findInjectTarget: () => HTMLElement | null;
}

interface DisplayedSummary {
  text: string;
  videoId: string;
  videoTitle: string;
  outputLanguage: OutputLanguage;
  languageStatus: OutputLanguageStatus;
}

interface YouTubePlayer {
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime?: () => number;
  playVideo?: () => void;
}

const SUMMARY_SOURCE = "youtube";

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

// ---------------------------------------------------------------------------
// Wait for YouTube's asynchronously rendered player target
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

  const initialSettings = await getSettings();
  let outputLanguage: OutputLanguage = initialSettings.outputLanguage;
  logI18nDebug("content initialized", {
    chromeUiLocale: getUiLocale(),
    outputLanguage,
    providerId: initialSettings.provider,
    modelId: initialSettings.model,
  });

  // ── Shared state ───────────────────────────────────────────────────
  let transcriptData: Transcript | null = null;
  let transcriptVideoId = "";
  let transcriptChunks: TranslationChunk[] = [];
  let translatedCues: Record<number, TranslatedSegment> = {};
  let partialTranslatedCues: Record<number, TranslatedSegment> = {};
  let translationIdentityKey = "";
  let transcriptView: TranscriptView = "source";
  let activeChunkId = 0;
  let loadedChunkStart = 0;
  let loadedChunkEnd = 0;
  let transcriptWithTimestamps = true;
  let transcriptScrollTop = 0;
  let translationTask: Promise<void> | null = null;
  let translationAbort: AbortController | null = null;
  let translationJobs: TranslationJob[] = [];
  let currentTranslationJob: TranslationJob | null = null;
  let fullTranslationRequested = false;
  let summaryAbort: AbortController | null = null;
  let summaryTranslationAbort: AbortController | null = null;
  let displayedSummary: DisplayedSummary | null = null;
  let translationProgressText = "";
  let transcriptStateVersion = 0;
  let currentPanel: Panel | null = null;
  let bilingualEnabled = initialSettings.bilingualSubtitlesEnabled;
  let bilingualOverlay: BilingualSubtitleOverlay | null = null;
  let bilingualVideo: HTMLVideoElement | null = null;
  let bilingualSyncHandler: (() => void) | null = null;
  let bilingualFrameCallbackId: number | null = null;
  let bilingualFrameCueId = -2;
  let autoTranslationErrors: Record<number, string> = {};
  let autoTranslationBlockedMessage = "";

  type TranslationJobKind = "overlay" | "section" | "all";
  interface TranslationJob {
    kind: TranslationJobKind;
    targetStart: number;
    targetEnd: number;
    forceRefresh: boolean;
    sectionId?: number;
  }

  function destroyBilingualOverlay(): void {
    if (bilingualVideo && bilingualSyncHandler) {
      for (const event of ["timeupdate", "seeking", "seeked", "loadedmetadata", "play"]) {
        bilingualVideo.removeEventListener(event, bilingualSyncHandler);
      }
    }
    if (bilingualVideo && bilingualFrameCallbackId !== null) {
      bilingualVideo.cancelVideoFrameCallback(bilingualFrameCallbackId);
    }
    bilingualFrameCallbackId = null;
    bilingualFrameCueId = -2;
    bilingualVideo = null;
    bilingualSyncHandler = null;
    bilingualOverlay?.destroy();
    bilingualOverlay = null;
  }

  function clearTranscriptState(): void {
    transcriptStateVersion += 1;
    translationAbort?.abort();
    summaryAbort?.abort();
    summaryTranslationAbort?.abort();
    summaryAbort = null;
    summaryTranslationAbort = null;
    displayedSummary = null;
    transcriptData = null;
    transcriptVideoId = "";
    transcriptChunks = [];
    translatedCues = {};
    partialTranslatedCues = {};
    translationIdentityKey = "";
    transcriptView = "source";
    translationTask = null;
    translationAbort = null;
    translationJobs = [];
    currentTranslationJob = null;
    fullTranslationRequested = false;
    autoTranslationErrors = {};
    autoTranslationBlockedMessage = "";
    translationProgressText = "";
    transcriptScrollTop = 0;
    destroyBilingualOverlay();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      const apiKeyChanged = Object.keys(changes).some((key) => key.startsWith("vas-api-key:"));
      if (apiKeyChanged && bilingualEnabled && autoTranslationBlockedMessage) {
        autoTranslationErrors = {};
        autoTranslationBlockedMessage = "";
        setTimeout(() => syncBilingualOverlay(), 0);
      }
      return;
    }
    if (areaName !== "sync") return;
    const nextLanguage = changes.outputLanguage?.newValue;
    if (isOutputLanguage(nextLanguage) && nextLanguage !== outputLanguage) {
      logI18nDebug("content output language changed", {
        previousOutputLanguage: outputLanguage,
        outputLanguage: nextLanguage,
      });
      outputLanguage = nextLanguage;
      clearTranscriptState();
      currentPanel?.reset();
      currentPanel?.setTranslationAvailable(true);
      currentPanel?.setBilingualSubtitlesEnabled(bilingualEnabled);
      if (bilingualEnabled && extractor.isOnVideoPage()) {
        void activateBilingualOverlay();
      }
    }

    const nextBilingual = changes.bilingualSubtitlesEnabled?.newValue;
    if (typeof nextBilingual === "boolean" && nextBilingual !== bilingualEnabled) {
      bilingualEnabled = nextBilingual;
      currentPanel?.setBilingualSubtitlesEnabled(bilingualEnabled);
      autoTranslationErrors = {};
      autoTranslationBlockedMessage = "";
      if (bilingualEnabled && extractor.isOnVideoPage()) void activateBilingualOverlay();
      else destroyBilingualOverlay();
    }

    if (changes.provider || changes.model) {
      translationAbort?.abort();
      translationJobs = [];
      translatedCues = {};
      partialTranslatedCues = {};
      translationIdentityKey = "";
      autoTranslationErrors = {};
      autoTranslationBlockedMessage = "";
      if (bilingualEnabled && transcriptData) {
        void ensureTranslationCache().then(() => syncBilingualOverlay()).catch(() => {});
      }
    }
  });

  async function ensureTranscript(
    panel: Panel,
    expectedVersion: number = transcriptStateVersion,
  ): Promise<Transcript> {
    const videoId = extractor.getVideoId();
    if (transcriptData && transcriptVideoId === videoId) return transcriptData;
    const transcript = buildAlignedTranscript(await extractor.getTranscript());
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
    if (isTranscriptInOutputLanguage(transcript.languageCode, outputLanguage)) {
      panel.setTranslationAvailable(false);
    }
    return transcript;
  }

  function showSummaryTranslationAction(panel: Panel, summary: DisplayedSummary): void {
    panel.showSummaryTranslationAction(
      getOutputLanguageInfo(summary.outputLanguage).nativeName,
    );
    panel.setSummaryTranslationAttention(summary.languageStatus === "mismatch");
  }

  async function detectDisplayedSummaryLanguage(
    panel: Panel,
    summary: DisplayedSummary,
    requestId: string,
    source: "generated" | "cache" | "translation",
  ): Promise<void> {
    const detection = await detectOutputLanguage(summary.text, summary.outputLanguage);
    if (displayedSummary !== summary || outputLanguage !== summary.outputLanguage) return;

    summary.languageStatus = detection.status;
    panel.setSummaryTranslationAttention(detection.status === "mismatch");
    logI18nDebug("summary language detected", {
      requestId,
      source,
      requestedLanguage: summary.outputLanguage,
      status: detection.status,
      isReliable: detection.isReliable,
      detectedLanguage: detection.detectedLanguage,
      percentage: detection.percentage,
      languages: detection.languages,
    });
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
    panel.setCurrentSectionTranslated(
      Array.from(
        { length: chunk.targetEnd - chunk.targetStart + 1 },
        (_, offset) => chunk.targetStart + offset,
      ).every((cueId) => Boolean(translatedCues[cueId])),
    );
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
      translations: translatedCues,
      partialTranslations: partialTranslatedCues,
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
      translatedCues = {};
      partialTranslatedCues = {};
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
          for (const segment of section.segments) {
            const source = transcript.segments[segment.cueId];
            if (
              source &&
              segment.cueId >= chunk.targetStart &&
              segment.cueId <= chunk.targetEnd &&
              segment.start === source.start &&
              segment.duration === source.duration &&
              segment.sourceStartId === (source.sourceStartId ?? segment.cueId) &&
              segment.sourceEndId === (source.sourceEndId ?? segment.cueId)
            ) {
              translatedCues[segment.cueId] = segment;
            }
          }
        }
      }
      translationIdentityKey = key;
    }
    return identity;
  }

  function mountPanel(target: HTMLElement): Panel {
    currentPanel?.destroy();
    const panel = new Panel(callbacks);
    currentPanel = panel;
    panel.getContentElement().addEventListener(
      "scroll",
      () => handleTranscriptScroll(panel),
      { passive: true },
    );
    panel.setTranslationAvailable(true);
    panel.setBilingualSubtitlesEnabled(bilingualEnabled);
    const title = extractor.getVideoTitle();
    if (title) panel.setTitle(title);
    panel.setTheme(isYouTubeDarkMode());
    panel.injectTrigger(target);
    panel.bindToPlayer(target);
    panel.injectPanel(document.body);
    void panel.initPanelWidth();
    if (bilingualEnabled) void activateBilingualOverlay(target);
    return panel;
  }

  function getPanel(): Panel {
    if (!currentPanel || !document.getElementById("vas-root")) {
      return mountPanel(config.findInjectTarget() || document.body);
    }
    return currentPanel;
  }

  function isChunkTranslated(chunk: TranslationChunk): boolean {
    for (let cueId = chunk.targetStart; cueId <= chunk.targetEnd; cueId++) {
      if (!translatedCues[cueId]) return false;
    }
    return true;
  }

  function clearPartialRange(start: number, end: number): void {
    for (let cueId = start; cueId <= end; cueId++) delete partialTranslatedCues[cueId];
  }

  function commitTranslatedSegments(segments: TranslatedSegment[]): void {
    for (const segment of segments) {
      translatedCues[segment.cueId] = segment;
      delete partialTranslatedCues[segment.cueId];
      delete autoTranslationErrors[segment.cueId];
    }
  }

  async function persistTranslationRange(
    identity: TranslationCacheIdentity,
    start: number,
    end: number,
  ): Promise<void> {
    const affected = transcriptChunks.filter(
      (chunk) => chunk.targetEnd >= start && chunk.targetStart <= end,
    );
    for (const chunk of affected) {
      const segments: TranslatedSegment[] = [];
      for (let cueId = chunk.targetStart; cueId <= chunk.targetEnd; cueId++) {
        if (translatedCues[cueId]) segments.push(translatedCues[cueId]);
      }
      if (!segments.length) continue;
      await setCachedTranslationSection(identity, {
        chunkId: chunk.id,
        targetStart: chunk.targetStart,
        targetEnd: chunk.targetEnd,
        segments,
      });
    }
  }

  async function persistTranslationRangeSafely(
    identity: TranslationCacheIdentity,
    start: number,
    end: number,
  ): Promise<void> {
    try {
      await persistTranslationRange(identity, start, end);
    } catch (error) {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.debug("[vas] Translation cache write failed:", detail);
      if (currentPanel?.getMode() === "transcript") {
        currentPanel.showWarning(t("translationCacheWriteFailed"));
      }
    }
  }

  function renderTranslationConsumers(): void {
    const panel = currentPanel;
    if (panel?.getMode() === "transcript") renderTranscriptReader(panel);
    syncBilingualOverlay();
  }

  async function processTranslationJob(
    job: TranslationJob,
    controller: AbortController,
    stateVersion: number,
  ): Promise<void> {
    const transcript = transcriptData!;
    const identity = await ensureTranslationCache(stateVersion);
    const assertCurrent = () => {
      if (controller.signal.aborted || stateVersion !== transcriptStateVersion) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
    };
    assertCurrent();

    if (job.forceRefresh) {
      const affected = transcriptChunks.filter(
        (chunk) => chunk.targetEnd >= job.targetStart && chunk.targetStart <= job.targetEnd,
      );
      for (const chunk of affected) await invalidateTranslationSection(identity, chunk.id);
      for (let cueId = job.targetStart; cueId <= job.targetEnd; cueId++) {
        delete translatedCues[cueId];
        delete autoTranslationErrors[cueId];
      }
      assertCurrent();
    }

    const ranges: Array<{ start: number; end: number }> = [];
    let cursor = job.targetStart;
    while (cursor <= job.targetEnd) {
      while (cursor <= job.targetEnd && translatedCues[cursor]) cursor += 1;
      if (cursor > job.targetEnd) break;
      const start = cursor;
      while (cursor <= job.targetEnd && !translatedCues[cursor]) cursor += 1;
      ranges.push({ start, end: cursor - 1 });
    }

    for (const range of ranges) {
      assertCurrent();
      const requestChunk: TranslationChunk = {
        id: job.sectionId ?? -1,
        targetStart: range.start,
        targetEnd: range.end,
        contextStart: Math.max(0, range.start - 8),
        contextEnd: Math.min(transcript.segments.length - 1, range.end + 8),
      };
      let latestPartial: TranslatedSegment[] = [];
      clearPartialRange(range.start, range.end);
      try {
        const result = await translateTranscriptChunk(
          transcript,
          requestChunk,
          identity.targetLanguage,
          (partial, formatRetry) => {
            if (controller.signal.aborted || stateVersion !== transcriptStateVersion) return;
            latestPartial = partial;
            clearPartialRange(range.start, range.end);
            for (const segment of partial) partialTranslatedCues[segment.cueId] = segment;
            if (formatRetry && job.sectionId !== undefined) {
              translationProgressText = t("repairingSectionFormat", String(job.sectionId + 1));
            }
            renderTranslationConsumers();
          },
          controller.signal,
        );
        assertCurrent();
        clearPartialRange(range.start, range.end);
        commitTranslatedSegments(result);
        await persistTranslationRangeSafely(identity, range.start, range.end);
      } catch (error) {
        clearPartialRange(range.start, range.end);
        if (latestPartial.length) {
          commitTranslatedSegments(latestPartial);
          await persistTranslationRangeSafely(identity, range.start, range.end);
        }
        throw error;
      } finally {
        renderTranslationConsumers();
      }
    }
    if (job.kind !== "overlay") autoTranslationBlockedMessage = "";
  }

  function enqueueTranslationJob(job: TranslationJob): void {
    if (!transcriptData || job.targetStart > job.targetEnd) return;
    const alreadyCurrent = currentTranslationJob &&
      currentTranslationJob.kind === job.kind &&
      currentTranslationJob.targetStart <= job.targetStart &&
      currentTranslationJob.targetEnd >= job.targetEnd;
    const alreadyQueued = translationJobs.some((queued) =>
      queued.kind === job.kind &&
      queued.targetStart <= job.targetStart &&
      queued.targetEnd >= job.targetEnd,
    );
    if (alreadyCurrent || alreadyQueued) return;

    if (job.kind === "overlay") {
      translationJobs = translationJobs.filter((queued) => queued.kind !== "overlay");
      if (
        currentTranslationJob?.kind === "overlay" &&
        (job.targetStart > currentTranslationJob.targetEnd ||
          job.targetEnd < currentTranslationJob.targetStart)
      ) {
        translationAbort?.abort();
      }
      translationJobs.unshift(job);
    } else if (job.kind === "section") {
      const firstNonOverlay = translationJobs.findIndex((queued) => queued.kind !== "overlay");
      translationJobs.splice(firstNonOverlay < 0 ? translationJobs.length : firstNonOverlay, 0, job);
    } else {
      translationJobs.push(job);
    }
    startTranslationWorker();
  }

  function startTranslationWorker(): void {
    if (translationTask || !transcriptData) return;
    const stateVersion = transcriptStateVersion;
    const panel = getPanel();
    panel.setTranslationActionsBusy(true);
    const task = (async () => {
      while (translationJobs.length && stateVersion === transcriptStateVersion) {
        const job = translationJobs.shift()!;
        currentTranslationJob = job;
        const controller = new AbortController();
        translationAbort = controller;
        if (job.kind === "all") {
          const completed = transcriptChunks.filter(isChunkTranslated).length;
          translationProgressText = t("translatingAllProgress", [
            String(completed),
            String(transcriptChunks.length),
          ]);
        } else if (job.kind === "section" && job.sectionId !== undefined) {
          translationProgressText = t("translatingSectionProgress", [
            String(job.sectionId + 1),
            String(transcriptChunks.length),
          ]);
        }
        panel.setTranslationProgress(translationProgressText);

        try {
          await processTranslationJob(job, controller, stateVersion);
          bilingualOverlay?.setSourceReady(true);
          if (job.kind === "section") translationProgressText = t("translationSectionDone");
        } catch (error) {
          if ((error as Error)?.name !== "AbortError") {
            const message = error instanceof Error ? error.message : t("translationFailed");
            if (job.kind === "overlay") {
              autoTranslationBlockedMessage = message;
              for (let cueId = job.targetStart; cueId <= job.targetEnd; cueId++) {
                if (!translatedCues[cueId]) autoTranslationErrors[cueId] = message;
              }
              if ((error as Error)?.name === "NoApiKeyError") {
                bilingualOverlay?.setSourceReady(false);
              }
            } else {
              translationProgressText = t("translationStopped", message);
              translationJobs = translationJobs.filter((queued) => queued.kind === "overlay");
              fullTranslationRequested = false;
              if (panel.getMode() === "transcript") panel.showWarning(message);
            }
            const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
            console.debug("[vas] Translation stopped:", detail);
          }
        } finally {
          currentTranslationJob = null;
          translationAbort = null;
          renderTranslationConsumers();
        }
      }
      if (fullTranslationRequested && transcriptChunks.every(isChunkTranslated)) {
        translationProgressText = t("translationAllDone");
      }
      fullTranslationRequested = false;
    })().finally(() => {
      if (translationTask !== task) return;
      translationTask = null;
      translationAbort = null;
      currentTranslationJob = null;
      panel.setTranslationActionsBusy(false);
      panel.setTranslationProgress(translationProgressText);
      renderTranslationConsumers();
      if (translationJobs.length) startTranslationWorker();
    });
    translationTask = task;
  }

  function runTranslationQueue(
    panel: Panel,
    requestedChunkIds: number[],
    forceRefresh: boolean,
    isFullTranslation: boolean,
  ): void {
    if (!transcriptData) return;
    if (!isFullTranslation) {
      transcriptView = "translation";
      panel.setTranscriptView("translation");
    }
    const chunks = requestedChunkIds
      .map((chunkId) => transcriptChunks[chunkId])
      .filter(Boolean);
    const pending = chunks.filter((chunk) => forceRefresh || !isChunkTranslated(chunk));
    if (!pending.length) {
      translationProgressText = t(
        isFullTranslation ? "translationAllAlreadyDone" : "translationSectionAlreadyDone",
      );
      panel.setTranslationProgress(translationProgressText);
      return;
    }
    if (isFullTranslation) fullTranslationRequested = true;
    for (const chunk of pending) {
      enqueueTranslationJob({
        kind: isFullTranslation ? "all" : "section",
        targetStart: chunk.targetStart,
        targetEnd: chunk.targetEnd,
        forceRefresh,
        sectionId: chunk.id,
      });
    }
  }

  function maybeQueueOverlayPrefetch(currentCueId: number): void {
    if (!transcriptData || isTranscriptInOutputLanguage(transcriptData.languageCode, outputLanguage)) return;
    if (autoTranslationBlockedMessage) return;
    const range = getCaptionPrefetchRange(
      transcriptData.segments,
      currentCueId,
      getCurrentPlaybackTime(),
      (cueId) => Boolean(translatedCues[cueId]),
    );
    if (!range || autoTranslationErrors[range.start] || partialTranslatedCues[range.start]) return;
    enqueueTranslationJob({
      kind: "overlay",
      targetStart: range.start,
      targetEnd: range.end,
      forceRefresh: false,
    });
  }

  function retryBilingualTranslation(): void {
    if (!bilingualOverlay || !transcriptData || !bilingualEnabled) return;
    const currentTime = getCurrentPlaybackTime();
    const cueId = findActiveCueIndex(transcriptData.segments, currentTime);
    if (cueId < 0) return;

    autoTranslationBlockedMessage = "";
    autoTranslationErrors = {};
    bilingualOverlay.setSourceReady(true);
    const range = getCaptionPrefetchRange(
      transcriptData.segments,
      cueId,
      currentTime,
      (candidateCueId) => Boolean(translatedCues[candidateCueId]),
    );
    if (range) {
      clearPartialRange(range.start, range.end);
      enqueueTranslationJob({
        kind: "overlay",
        targetStart: range.start,
        targetEnd: range.end,
        forceRefresh: false,
      });
    }
    syncBilingualOverlay(currentTime);
  }

  function syncBilingualOverlay(playbackTime: number = getCurrentPlaybackTime()): void {
    if (!bilingualOverlay || !transcriptData || !bilingualEnabled) return;
    const cueId = findActiveCueIndex(transcriptData.segments, playbackTime);
    if (cueId < 0) {
      bilingualOverlay.setCue(null);
      return;
    }
    const source = transcriptData.segments[cueId];
    const translated = partialTranslatedCues[cueId] ?? translatedCues[cueId];
    const translationNeeded = !isTranscriptInOutputLanguage(
      transcriptData.languageCode,
      outputLanguage,
    );
    const errorText = translationNeeded && !translated
      ? (autoTranslationErrors[cueId] || autoTranslationBlockedMessage)
      : "";
    bilingualOverlay.setCue({
      sourceText: source.text,
      translationText: translationNeeded ? translated?.text : undefined,
      statusText: translationNeeded && !translated
        ? (errorText || t("bilingualTranslating"))
        : undefined,
      retryText: errorText ? t("bilingualRetry") : undefined,
    });
    if (translationNeeded) maybeQueueOverlayPrefetch(cueId);
  }

  async function activateBilingualOverlay(preferredPlayer?: HTMLElement): Promise<void> {
    if (!bilingualEnabled || !extractor.isOnVideoPage()) return;
    const player = preferredPlayer?.matches("#movie_player, #player-container, #player")
      ? preferredPlayer
      : config.findInjectTarget();
    if (!player) return;
    destroyBilingualOverlay();
    const overlay = new BilingualSubtitleOverlay(player, () => {
      if (bilingualOverlay !== overlay) return;
      if (transcriptData) retryBilingualTranslation();
      else void activateBilingualOverlay(player);
    });
    bilingualOverlay = overlay;
    overlay.setCue({ sourceText: t("fetchingTranscript") });
    const stateVersion = transcriptStateVersion;
    try {
      const transcript = await ensureTranscript(getPanel(), stateVersion);
      if (!bilingualEnabled || bilingualOverlay !== overlay || stateVersion !== transcriptStateVersion) return;
      if (!transcriptChunks.length) transcriptChunks = buildTranslationChunks(transcript.segments);
      if (!isTranscriptInOutputLanguage(transcript.languageCode, outputLanguage)) {
        await ensureTranslationCache(stateVersion);
      }
      if (!bilingualEnabled || bilingualOverlay !== overlay || stateVersion !== transcriptStateVersion) return;
      overlay.setSourceReady(true);
      const video = player.querySelector("video") ?? document.querySelector("video");
      if (video) {
        bilingualVideo = video;
        bilingualSyncHandler = () => syncBilingualOverlay();
        for (const event of ["timeupdate", "seeking", "seeked", "loadedmetadata", "play"]) {
          video.addEventListener(event, bilingualSyncHandler, { passive: true });
        }
        if (typeof video.requestVideoFrameCallback === "function") {
          const syncVideoFrame: VideoFrameRequestCallback = (_now, metadata) => {
            if (bilingualVideo !== video || bilingualOverlay !== overlay || !bilingualEnabled) return;
            const frameCueId = transcriptData
              ? findActiveCueIndex(transcriptData.segments, metadata.mediaTime)
              : -1;
            if (frameCueId !== bilingualFrameCueId) {
              bilingualFrameCueId = frameCueId;
              syncBilingualOverlay(metadata.mediaTime);
            }
            bilingualFrameCallbackId = video.requestVideoFrameCallback(syncVideoFrame);
          };
          bilingualFrameCallbackId = video.requestVideoFrameCallback(syncVideoFrame);
        }
      }
      syncBilingualOverlay();
    } catch (error) {
      if ((error as Error)?.name === "AbortError" || bilingualOverlay !== overlay) return;
      overlay.setSourceReady(false);
      overlay.setCue({
        sourceText: error instanceof Error ? error.message : t("translationFailed"),
        retryText: t("bilingualRetry"),
      });
    }
  }

  // ── Callbacks ──────────────────────────────────────────────────────
  const callbacks = {
    onSummarize: async () => {
      const panel = getPanel();
      const requestedLanguage = outputLanguage;
      const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      summaryTranslationAbort?.abort();
      summaryTranslationAbort = null;
      displayedSummary = null;
      panel.hideSummaryTranslationAction();
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
        logI18nDebug("summary started", {
          requestId,
          requestedLanguage,
          forceRefresh: isForceRefresh,
        });

        if (isForceRefresh) {
          await runSummaryCacheOperation(
            "invalidation",
            () => invalidateCache(SUMMARY_SOURCE, videoId, requestedLanguage),
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
            () => getCachedSummary(SUMMARY_SOURCE, videoId, requestedLanguage),
            reportCacheFailure,
          );
          assertCurrent();
          if (cached) {
            logI18nDebug("summary cache hit", {
              requestId,
              requestedLanguage,
              cachedOutputLanguage: cached.outputLanguage,
              cacheAgeMs: Date.now() - cached.timestamp,
              outputCharacters: cached.text.length,
              outputScripts: analyzeTextScripts(cached.text),
            });
            const summaryState: DisplayedSummary = {
              text: cached.text,
              videoId,
              videoTitle: videoTitle || cached.videoTitle,
              outputLanguage: requestedLanguage,
              languageStatus: "uncertain",
            };
            displayedSummary = summaryState;
            // 缓存命中——直接显示
            panel.setTitle(videoTitle || cached.videoTitle);
            panel.setContent(renderMarkdown(cached.text));
            showSummaryTranslationAction(panel, summaryState);
            panel.setMode("summary");
            panel.setCachedView(true);
            panel.setSummarizeButtonText(t("summarizeAgain"));

            // 显示缓存时间
            const elapsed = Date.now() - cached.timestamp;
            const hint = formatCacheAge(elapsed);
            panel.showCacheHint(t("cachedAt", hint));
            panel.open();
            await detectDisplayedSummaryLanguage(panel, summaryState, requestId, "cache");
            assertCurrent();
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
        const aiIdentity = await getActiveAIIdentity();
        assertCurrent();
        logI18nDebug("summary request prepared", {
          requestId,
          requestedLanguage,
          sourceLanguage: transcript.languageCode,
          transcriptSegments: transcript.segments.length,
          transcriptCharacters: transcriptText.length,
          providerId: aiIdentity.providerId,
          modelId: aiIdentity.modelId,
        });

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
        pendingRender = false;
        renderStreaming(contentEl, buffer);
        logI18nDebug("summary response completed", {
          requestId,
          requestedLanguage,
          outputCharacters: buffer.length,
          outputScripts: analyzeTextScripts(buffer),
        });

        // 保存到缓存
        if (buffer.trim()) {
          await runSummaryCacheOperation(
            "write",
            () => setCachedSummary(
              SUMMARY_SOURCE,
              videoId,
              videoTitle,
              buffer,
              requestedLanguage,
            ),
            reportCacheFailure,
          );
          assertCurrent();
        }

        const summaryState: DisplayedSummary | null = buffer.trim()
          ? {
              text: buffer,
              videoId,
              videoTitle,
              outputLanguage: requestedLanguage,
              languageStatus: "uncertain",
            }
          : null;
        displayedSummary = summaryState;
        if (summaryState) showSummaryTranslationAction(panel, summaryState);
        panel.setMode("summary");
        // API 获取的新内容，标记为可「再次总结」
        panel.setCachedView(true);
        panel.setSummarizeButtonText(t("summarizeAgain"));
        if (cacheFailed) {
          panel.showWarning(t("summaryCacheUnavailable"));
        }
        if (summaryState) {
          await detectDisplayedSummaryLanguage(panel, summaryState, requestId, "generated");
          assertCurrent();
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          logI18nDebug("summary aborted", { requestId, requestedLanguage });
          return;
        }
        logI18nDebug("summary failed", {
          requestId,
          requestedLanguage,
          errorName: (err as Error)?.name ?? "unknown",
        });
        handleError(err, panel);
      } finally {
        if (renderFrameId !== null) cancelAnimationFrame(renderFrameId);
        if (summaryAbort === summaryController) summaryAbort = null;
      }
    },

    onTranslateSummary: async () => {
      const sourceSummary = displayedSummary;
      if (!sourceSummary?.text.trim() || summaryTranslationAbort) return;

      const panel = getPanel();
      const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const controller = new AbortController();
      summaryTranslationAbort = controller;
      let renderFrameId: number | null = null;
      let pendingRender = false;
      let streamStarted = false;
      let translatedText = "";
      let cacheFailed = false;

      const assertSourceCurrent = () => {
        if (
          controller.signal.aborted ||
          summaryTranslationAbort !== controller ||
          displayedSummary !== sourceSummary ||
          outputLanguage !== sourceSummary.outputLanguage ||
          extractor.getVideoId() !== sourceSummary.videoId
        ) {
          throw new DOMException("The operation was aborted", "AbortError");
        }
      };

      panel.setSummaryTranslationBusy(true);
      logI18nDebug("summary manual translation started", {
        requestId,
        requestedLanguage: sourceSummary.outputLanguage,
        sourceCharacters: sourceSummary.text.length,
        sourceScripts: analyzeTextScripts(sourceSummary.text),
      });

      try {
        const contentEl = panel.getContentElement();
        for await (const chunk of translateSummaryStream(
          sourceSummary.text,
          sourceSummary.outputLanguage,
          controller.signal,
        )) {
          assertSourceCurrent();
          if (!streamStarted) {
            streamStarted = true;
            panel.beginStreaming();
          }
          translatedText += chunk;
          if (!pendingRender) {
            pendingRender = true;
            renderFrameId = requestAnimationFrame(() => {
              if (!controller.signal.aborted && displayedSummary === sourceSummary) {
                renderStreaming(contentEl, translatedText);
              }
              pendingRender = false;
            });
          }
        }
        assertSourceCurrent();
        if (!translatedText.trim()) throw new Error(t("errorTranslationEmpty"));

        if (renderFrameId !== null) cancelAnimationFrame(renderFrameId);
        renderFrameId = null;
        pendingRender = false;
        renderStreaming(contentEl, translatedText);

        const translatedSummary: DisplayedSummary = {
          ...sourceSummary,
          text: translatedText,
          languageStatus: "uncertain",
        };
        displayedSummary = translatedSummary;
        showSummaryTranslationAction(panel, translatedSummary);
        panel.setMode("summary");
        panel.setCachedView(true);

        await runSummaryCacheOperation(
          "write",
          () => setCachedSummary(
            SUMMARY_SOURCE,
            translatedSummary.videoId,
            translatedSummary.videoTitle,
            translatedSummary.text,
            translatedSummary.outputLanguage,
          ),
          () => { cacheFailed = true; },
        );
        if (
          controller.signal.aborted ||
          summaryTranslationAbort !== controller ||
          displayedSummary !== translatedSummary
        ) {
          throw new DOMException("The operation was aborted", "AbortError");
        }

        await detectDisplayedSummaryLanguage(
          panel,
          translatedSummary,
          requestId,
          "translation",
        );
        logI18nDebug("summary manual translation completed", {
          requestId,
          requestedLanguage: translatedSummary.outputLanguage,
          outputCharacters: translatedText.length,
          outputScripts: analyzeTextScripts(translatedText),
          languageStatus: translatedSummary.languageStatus,
        });
        if (cacheFailed) panel.showWarning(t("summaryCacheUnavailable"));
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;

        if (displayedSummary === sourceSummary) {
          panel.setContent(renderMarkdown(sourceSummary.text));
          panel.setMode("summary");
          showSummaryTranslationAction(panel, sourceSummary);
          panel.showWarning(t("summaryTranslationFailed"));
        }
        logI18nDebug("summary manual translation failed", {
          requestId,
          requestedLanguage: sourceSummary.outputLanguage,
          errorName: (error as Error)?.name ?? "unknown",
        });
      } finally {
        if (renderFrameId !== null) cancelAnimationFrame(renderFrameId);
        if (summaryTranslationAbort === controller) summaryTranslationAbort = null;
        panel.setSummaryTranslationBusy(false);
      }
    },

    onTranscript: async (withTimestamps: boolean) => {
      const panel = getPanel();
      summaryTranslationAbort?.abort();
      summaryTranslationAbort = null;
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
          if (!isTranscriptInOutputLanguage(transcript.languageCode, outputLanguage)) {
            await ensureTranslationCache();
          }
        }
        panel.setMode("transcript");
        panel.setTranslationAvailable(
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

    onTranscriptViewChange: (view: TranscriptView) => {
      transcriptView = view;
      renderTranscriptReader(getPanel());
    },

    onTranslateCurrent: (forceRefresh: boolean) => {
      runTranslationQueue(getPanel(), [activeChunkId], forceRefresh, false);
    },

    onTranslateAll: () => {
      runTranslationQueue(
        getPanel(),
        transcriptChunks.map((chunk) => chunk.id),
        false,
        true,
      );
    },

    onBilingualSubtitlesChange: (enabled: boolean) => {
      bilingualEnabled = enabled;
      autoTranslationErrors = {};
      autoTranslationBlockedMessage = "";
      void setSettings({ bilingualSubtitlesEnabled: enabled }).catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        console.debug("[vas] Failed to persist bilingual subtitle setting:", detail);
      });
      if (enabled) {
        void activateBilingualOverlay();
      } else {
        translationJobs = translationJobs.filter((job) => job.kind !== "overlay");
        if (currentTranslationJob?.kind === "overlay") translationAbort?.abort();
        destroyBilingualOverlay();
      }
    },

    onClose: () => {
      summaryAbort?.abort();
      summaryTranslationAbort?.abort();
      translationJobs = translationJobs.filter((job) => job.kind === "overlay");
      if (currentTranslationJob?.kind !== "overlay") translationAbort?.abort();
    },

    onSeek: (seconds: number) => {
      // 优先用 YouTube 播放器 API（同视频 SPA 内 seek，无网络请求）；
      // 回退到直接操作 <video>，兼容播放器 API 暂不可用的情况。
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

    let target: HTMLElement;
    try {
      target = await waitForTarget(config.findInjectTarget, 30000);
    } catch {
      console.debug("[vas] Player target not found, using body fallback");
      target = document.body;
    }

    mountPanel(target);
  }

  function destroyPanel(): void {
    destroyBilingualOverlay();
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
      const overlayInDom = document.getElementById("vas-bilingual-overlay");

      if (!vasRoot || !triggerInDom) {
        console.log(`[vas] UI missing after ${delay}ms (root=${!!vasRoot}, trigger=${!!triggerInDom}), re-injecting...`);
        injectOnVideoPage();
      }
      if (vasRoot && bilingualEnabled && !overlayInDom) void activateBilingualOverlay();
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
          p.setTranslationAvailable(true);
          p.setBilingualSubtitlesEnabled(bilingualEnabled);
          const t = extractor.getVideoTitle();
          if (t) p.setTitle(t);
          p.setTheme(isYouTubeDarkMode());

          // Re-inject trigger if YouTube rebuilt the player
          if (!p.getTrigger().parentNode) {
            const newTarget = config.findInjectTarget() || document.body;
            p.injectTrigger(newTarget);
            p.bindToPlayer(newTarget);
          }
          if (bilingualEnabled) void activateBilingualOverlay();
        }, 800);
      }
    } else {
      // Left the video page
      destroyPanel();
    }
  });
}
