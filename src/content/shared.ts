import { normalizeCaptionLanguage } from "../utils/caption-language";
import { downloadCaptionDiagnostics } from "../service/caption-diagnostics";
import { getOverlayPrefetchChunk } from "./caption-prefetch";
/** YouTube 内容脚本的 UI、字幕、翻译和 SPA 生命周期编排。 */

import { Panel, type TranscriptView } from "./ui/panel";
import { BilingualSubtitleOverlay } from "./ui/bilingual-overlay";
import { PlayerTranslationToggle } from "./ui/player-translation-toggle";
import { PlayerOnboarding } from "./ui/player-onboarding";
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
import { prepareCaptionSource, fingerprintCaptionSource } from "./caption-source";
import {
  findActiveCueIndex,
  isTranscriptInOutputLanguage,
  transcriptToText,
} from "./transcript";
import { UserError } from "../utils/errors";
import {
  translateTranscriptChunk,
  alignTranslatedParts,
  buildTranslationChunks,
  type TranslatedSegment,
  type TranslationChunk,
} from "../service/transcript-translation";
import {
  getCachedTranslation,
  setCachedTranslationSection,
  invalidateTranslationSection,
  clearVideoTranslationCache,
  type TranslationCacheIdentity,
} from "../service/translation-cache";
import {
  getCachedSummary,
  setCachedSummary,
  invalidateCache,
} from "../service/summary-cache";
import { handleError } from "./error-handler";
import { runSummaryCacheOperation } from "./summary-cache-operation";
import {
  CUSTOM_PROMPT_STORAGE_PREFIX,
  getCustomPromptProfile,
  getSettings,
} from "../service/storage";
import { normalizeSubtitleStyle } from "../service/subtitle-style";
import {
  getTranslationChunkLimits,
  isTranslationChunkPreset,
  type TranslationChunkPreset,
} from "../service/ai-controls";
import {
  activateUiLanguage,
  getOutputLanguageInfo,
  getUiLocale,
  isOutputLanguage,
  isUiLanguage,
  t,
  type OutputLanguage,
  type UiLanguage,
} from "../utils/i18n";
import { analyzeTextScripts, logI18nDebug } from "../utils/i18n-debug";
import {
  detectOutputLanguage,
  type OutputLanguageStatus,
} from "../utils/output-language-detection";
import {
  getTranscriptLazyLoadDirection,
  getTranscriptTargetScrollTop,
} from "./transcript-scroll";
import { resolveBilingualEnabled } from "./bilingual-preference";
import type { AISetupStatus } from "../service/ai-setup";
import { resolveAISelection } from "../service/model-registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Extractor {
  getTranscript: (preferredCaptionLanguage?: string) => Promise<Transcript>;
  clearTranscriptCache?: (videoId: string) => void | Promise<void>;
  /** Notifies when the page itself loaded usable captions for a video. */
  onCaptionsAvailable?: (listener: (videoId: string) => void) => () => void;
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

interface LocalizedMessage {
  key: string;
  substitutions?: string | string[];
}

function localizedText(message: LocalizedMessage | null): string {
  return message ? t(message.key, message.substitutions) : "";
}

interface YouTubePlayer {
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime?: () => number;
  playVideo?: () => void;
}

const SUMMARY_SOURCE = "youtube";

async function requestAISetupStatus(fallback: AISetupStatus): Promise<AISetupStatus> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_API_KEY_STATUS" }) as Partial<AISetupStatus>;
    if (
      typeof response?.providerId === "string" &&
      typeof response.providerName === "string" &&
      typeof response.hasKey === "boolean"
    ) {
      return response as AISetupStatus;
    }
  } catch (error) {
    console.debug("[vas] AI setup status request failed:", error);
  }
  return fallback;
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
export function watchNavigation(onChange: () => void): () => void {
  let lastUrl = window.location.href;
  const check = () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      onChange();
    }
  };

  // YouTube's own SPA event. DOM events cross the isolated-world boundary;
  // overriding history.pushState here would not (the page calls its own copy),
  // which is why that interception never fired and navigation was only noticed
  // whenever <title> happened to change after the URL.
  document.addEventListener("yt-navigate-finish", check);
  // Fallbacks: title changes and back/forward.
  const titleObserver = new MutationObserver(check);
  const titleEl = document.querySelector("title");
  if (titleEl) titleObserver.observe(titleEl, { childList: true, subtree: true });
  window.addEventListener("popstate", check);

  return () => {
    document.removeEventListener("yt-navigate-finish", check);
    titleObserver.disconnect();
    window.removeEventListener("popstate", check);
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
  const initialCustomPrompt = await getCustomPromptProfile(initialSettings.activeCustomPromptId);
  const initialSelection = resolveAISelection(initialSettings.provider, initialSettings.model);
  let aiSetupStatus = await requestAISetupStatus({
    providerId: initialSelection.provider.id,
    providerName: initialSelection.provider.name,
    hasKey: false,
  });
  try {
    await activateUiLanguage(initialSettings.uiLanguage);
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.debug("[vas] Content UI catalog load failed:", detail);
  }
  let activeUiLanguage: UiLanguage = initialSettings.uiLanguage;
  let outputLanguage: OutputLanguage = initialSettings.outputLanguage;
  let activeCustomPromptId = initialSettings.activeCustomPromptId;
  let activeCustomPromptInstruction = initialCustomPrompt?.instruction ?? "";
  let translationChunkPreset: TranslationChunkPreset = initialSettings.translationChunkPreset;
  logI18nDebug("content initialized", {
    chromeUiLocale: getUiLocale(),
    outputLanguage,
    providerId: initialSettings.provider,
    modelId: initialSettings.model,
  });

  // ── Shared state ───────────────────────────────────────────────────
  let preferredCaptionLanguage = normalizeCaptionLanguage(initialSettings.preferredCaptionLanguage);
  let transcriptData: Transcript | null = null;
  let transcriptVideoId = "";
  let transcriptFingerprint: Promise<string> | null = null;
  let cacheLoad: { key: string; version: number; revision: number; task: Promise<void> } | null = null;
  let transcriptChunks: TranslationChunk[] = [];
  let translatedSections: Record<number, TranslatedSegment[]> = {};
  let translationIdentityKey = "";
  let translationCacheRevision = 0;
  let translationCacheReset: { videoId: string; task: Promise<void> } | null = null;
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
  let translationProgressMessage: LocalizedMessage | null = null;
  let transcriptStateVersion = 0;
  let currentPanel: Panel | null = null;
  // Per-video choices live for this content-script lifetime and override the synced default.
  const bilingualStateByVideo = new Map<string, boolean>();
  let bilingualDefaultEnabled = initialSettings.bilingualSubtitlesDefaultEnabled;
  let bilingualEnabled = bilingualDefaultEnabled;
  let learningModeEnabled = initialSettings.learningModeEnabled;
  let translationOnlyEnabled = initialSettings.translationOnlyEnabled;
  let subtitleStyle = initialSettings.subtitleStyle;
  let bilingualOverlay: BilingualSubtitleOverlay | null = null;
  let bilingualVideo: HTMLVideoElement | null = null;
  let bilingualSyncHandler: (() => void) | null = null;
  let bilingualFrameCallbackId: number | null = null;
  let bilingualFrameCueId: string | number = -2;
  let autoTranslationErrors: Record<number, string> = {};
  let autoTranslationBlockedMessage = "";
  let recentCaptionTranslationMs: number[] = [];
  let captionPreferenceChangePending = false;
  /** Armed after a failed overlay load; the next usable player captions retry it once. */
  let captionRecovery: {
    videoId: string;
    overlay: BilingualSubtitleOverlay;
    player: HTMLElement;
  } | null = null;

  // Without this, a failed automatic load stayed failed even after the player
  // fetched captions itself (e.g. the user turned CC on): a second click on the
  // extension was always required. The retry hits the MAIN-world cache.
  extractor.onCaptionsAvailable?.((videoId) => {
    const recovery = captionRecovery;
    if (!recovery || videoId !== recovery.videoId || videoId !== extractor.getVideoId()) return;
    captionRecovery = null;
    if (bilingualOverlay !== recovery.overlay || transcriptData || !bilingualEnabled) return;
    void activateBilingualOverlay(recovery.player);
  });

  const playerTranslationToggle = new PlayerTranslationToggle((enabled) => {
    setBilingualEnabled(enabled);
  });
  const playerOnboarding = new PlayerOnboarding({
    getPlayer: config.findInjectTarget,
    getSummaryButton: () => currentPanel?.getTrigger() ?? null,
    getPanelToolbar: () => currentPanel?.getPanelContainer().shadowRoot?.querySelector<HTMLElement>(".vas-toolbar") ?? null,
    getSubtitleButton: () => playerTranslationToggle.getButton(),
    setSummaryVisible: (visible) => currentPanel?.setDiscoveryVisible(visible),
    openPanel: () => currentPanel?.open(),
    hasApiKey: () => aiSetupStatus.hasKey,
    isDark: isYouTubeDarkMode,
  });
  const themeObserver = new MutationObserver(() => {
    const isDark = isYouTubeDarkMode();
    currentPanel?.setTheme(isDark);
    playerOnboarding.setTheme(isDark);
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["dark", "class"],
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "REPLAY_PLAYER_ONBOARDING" || sender.id !== chrome.runtime.id) return;
    const available = extractor.isOnVideoPage() && Boolean(currentPanel);
    if (available) playerOnboarding.start(true);
    sendResponse({ started: available });
  });

  function renderAISetupAvailability(): void {
    currentPanel?.setAIAvailable(aiSetupStatus.hasKey, aiSetupStatus.providerName);
    playerTranslationToggle.setAvailable(aiSetupStatus.hasKey);
    playerOnboarding.refreshLocalizedText();
  }

  async function refreshAISetupAvailability(forceOverlay = false): Promise<void> {
    const previous = aiSetupStatus;
    aiSetupStatus = await requestAISetupStatus({ ...previous, hasKey: false });
    const providerChanged = previous.providerId !== aiSetupStatus.providerId;
    renderAISetupAvailability();
    if (!aiSetupStatus.hasKey) {
      if (currentPanel?.getMode() === "loading" || currentPanel?.getMode() === "error") {
        currentPanel.showSetupRequired();
      }
      summaryAbort?.abort();
      summaryTranslationAbort?.abort();
      translationAbort?.abort();
      translationJobs = [];
      autoTranslationErrors = {};
      autoTranslationBlockedMessage = "";
      destroyBilingualOverlay();
      return;
    }
    if (providerChanged) destroyBilingualOverlay();
    if ((forceOverlay || !previous.hasKey || providerChanged) && bilingualEnabled && extractor.isOnVideoPage()) {
      autoTranslationErrors = {};
      autoTranslationBlockedMessage = "";
      void activateBilingualOverlay();
    }
  }

  type TranslationJobKind = "overlay" | "section" | "all";
  interface TranslationJob {
    kind: TranslationJobKind;
    targetStart: number;
    targetEnd: number;
    forceRefresh: boolean;
    sectionId?: number;
    customInstruction?: string;
  }

  function buildConfiguredTranslationChunks(transcript: Transcript): TranslationChunk[] {
    const limits = getTranslationChunkLimits(translationChunkPreset);
    return buildTranslationChunks(transcript.segments, limits.maxChars, limits.maxSeconds);
  }

  async function refreshActiveCustomPrompt(): Promise<void> {
    const profile = await getCustomPromptProfile(activeCustomPromptId);
    if (activeCustomPromptId === profile?.id) {
      activeCustomPromptInstruction = profile.instruction;
    } else if (!profile) {
      activeCustomPromptInstruction = "";
    }
  }

  function destroyBilingualOverlay(): void {
    if (bilingualVideo && bilingualSyncHandler) {
      for (const event of ["timeupdate", "seeking", "seeked", "loadedmetadata", "play", "ratechange"]) {
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

  function setBilingualEnabled(enabled: boolean, rememberForVideo: boolean = true): void {
    const videoId = extractor.getVideoId();
    if (rememberForVideo && videoId) bilingualStateByVideo.set(videoId, enabled);
    bilingualEnabled = enabled;
    playerTranslationToggle.setEnabled(enabled);
    autoTranslationErrors = {};
    autoTranslationBlockedMessage = "";
    if (enabled && aiSetupStatus.hasKey && extractor.isOnVideoPage()) {
      void activateBilingualOverlay();
      return;
    }
    translationJobs = translationJobs.filter((job) => job.kind !== "overlay");
    if (currentTranslationJob?.kind === "overlay") translationAbort?.abort();
    destroyBilingualOverlay();
  }

  function restoreBilingualEnabledForCurrentVideo(): void {
    const videoId = extractor.getVideoId();
    bilingualEnabled = resolveBilingualEnabled(
      bilingualDefaultEnabled,
      videoId ? bilingualStateByVideo.get(videoId) : undefined,
    );
    playerTranslationToggle.setEnabled(bilingualEnabled);
  }

  /** Navigation: everything belongs to the previous video. */
  function clearTranscriptState(): void {
    clearSourceState();
    summaryAbort?.abort();
    summaryTranslationAbort?.abort();
    summaryAbort = null;
    summaryTranslationAbort = null;
    displayedSummary = null;
  }

  /**
   * A caption-source change (preferred language) invalidates captions,
   * segmentation and translations, but not a summary of the same video.
   * While a summary is running it is deferred: bumping the state version would
   * abort its transcript fetch silently and leave the panel loading forever.
   */
  function applyCaptionPreferenceChange(): void {
    if (summaryAbort) {
      captionPreferenceChangePending = true;
      return;
    }
    captionPreferenceChangePending = false;
    clearSourceState();
    if (currentPanel?.getMode() === "transcript") currentPanel.reset();
    if (bilingualEnabled) void activateBilingualOverlay();
  }

  function clearSourceState(): void {
    transcriptStateVersion += 1;
    translationAbort?.abort();
    captionRecovery = null;
    transcriptData = null;
    transcriptVideoId = "";
    transcriptFingerprint = null;
    cacheLoad = null;
    transcriptChunks = [];
    translatedSections = {};
    translationIdentityKey = "";
    transcriptView = "source";
    translationTask = null;
    translationAbort = null;
    translationJobs = [];
    currentTranslationJob = null;
    fullTranslationRequested = false;
    autoTranslationErrors = {};
    autoTranslationBlockedMessage = "";
    recentCaptionTranslationMs = [];
    translationProgressMessage = null;
    transcriptScrollTop = 0;
    destroyBilingualOverlay();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      const apiKeyChanged = Object.keys(changes).some((key) => key.startsWith("vas-api-key:"));
      if (apiKeyChanged) void refreshAISetupAvailability();
      return;
    }
    if (areaName !== "sync") return;
    if (changes.activeCustomPromptId) {
      const nextId = changes.activeCustomPromptId.newValue;
      activeCustomPromptId = typeof nextId === "string" && nextId ? nextId : null;
      void refreshActiveCustomPrompt();
    } else if (
      activeCustomPromptId &&
      changes[`${CUSTOM_PROMPT_STORAGE_PREFIX}${activeCustomPromptId}`]
    ) {
      void refreshActiveCustomPrompt();
    }

    const nextChunkPreset = changes.translationChunkPreset?.newValue;
    if (
      isTranslationChunkPreset(nextChunkPreset) &&
      nextChunkPreset !== translationChunkPreset
    ) {
      translationChunkPreset = nextChunkPreset;
      transcriptStateVersion += 1;
      translatedSections = {};
      translationIdentityKey = "";
      autoTranslationErrors = {};
      autoTranslationBlockedMessage = "";
      translationAbort?.abort();
      translationJobs = [];
      fullTranslationRequested = false;
      translationProgressMessage = null;
      if (transcriptData) {
        transcriptChunks = buildConfiguredTranslationChunks(transcriptData);
        activeChunkId = findChunkAtTime(getCurrentPlaybackTime());
        loadedChunkStart = Math.max(0, activeChunkId - 1);
        loadedChunkEnd = Math.min(transcriptChunks.length - 1, activeChunkId + 1);
        if (currentPanel?.getMode() === "transcript") renderTranscriptReader(currentPanel, false);
        syncBilingualOverlay();
      }
    }
    if (changes.preferredCaptionLanguage) {
      const next = normalizeCaptionLanguage(changes.preferredCaptionLanguage.newValue);
      if (next !== preferredCaptionLanguage) {
        preferredCaptionLanguage = next;
        applyCaptionPreferenceChange();
      }
    }
    const nextUiLanguage = changes.uiLanguage?.newValue;
    if (isUiLanguage(nextUiLanguage) && nextUiLanguage !== activeUiLanguage) {
      void activateUiLanguage(nextUiLanguage).then((activated) => {
        if (!activated) return;
        activeUiLanguage = nextUiLanguage;
        currentPanel?.refreshLocalizedText();
        playerTranslationToggle.refreshLocalizedText();
        playerOnboarding.refreshLocalizedText();
        if (currentPanel?.getMode() === "transcript") {
          renderTranscriptReader(currentPanel);
        } else if (currentPanel) {
          currentPanel.setTranslationProgress(localizedText(translationProgressMessage));
          if (displayedSummary) showSummaryTranslationAction(currentPanel, displayedSummary);
        }
        syncBilingualOverlay();
      }).catch((error) => {
        const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
        console.debug("[vas] Content UI language change failed:", detail);
      });
    }
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
      if (bilingualEnabled && aiSetupStatus.hasKey && extractor.isOnVideoPage()) {
        void activateBilingualOverlay();
      }
    }

    const nextLearningMode = changes.learningModeEnabled?.newValue;
    if (typeof nextLearningMode === "boolean" && nextLearningMode !== learningModeEnabled) {
      learningModeEnabled = nextLearningMode;
      bilingualOverlay?.setLearningMode(learningModeEnabled);
    }

    const nextTranslationOnly = changes.translationOnlyEnabled?.newValue;
    if (
      typeof nextTranslationOnly === "boolean" &&
      nextTranslationOnly !== translationOnlyEnabled
    ) {
      translationOnlyEnabled = nextTranslationOnly;
      bilingualOverlay?.setTranslationOnly(translationOnlyEnabled);
    }

    const nextBilingualDefault = changes.bilingualSubtitlesDefaultEnabled?.newValue;
    if (
      typeof nextBilingualDefault === "boolean" &&
      nextBilingualDefault !== bilingualDefaultEnabled
    ) {
      bilingualDefaultEnabled = nextBilingualDefault;
      const videoId = extractor.getVideoId();
      if (!videoId || !bilingualStateByVideo.has(videoId)) {
        setBilingualEnabled(bilingualDefaultEnabled, false);
      }
    }

    if (changes.subtitleStyle) {
      subtitleStyle = normalizeSubtitleStyle(changes.subtitleStyle.newValue);
      bilingualOverlay?.setStyle(subtitleStyle);
    }

    if (changes.provider || changes.model) {
      transcriptStateVersion += 1;
      translationAbort?.abort();
      translationJobs = [];
      translatedSections = {};
      translationIdentityKey = "";
      autoTranslationErrors = {};
      autoTranslationBlockedMessage = "";
      renderTranslationConsumers();
      void refreshAISetupAvailability(true);
    }
  });

  async function ensureTranscript(
    panel: Panel,
    expectedVersion: number = transcriptStateVersion,
  ): Promise<Transcript> {
    const videoId = extractor.getVideoId();
    if (transcriptData && transcriptVideoId === videoId) return transcriptData;
    const transcript = prepareCaptionSource(await extractor.getTranscript(preferredCaptionLanguage));
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
    // Prefer the latest block start: YouTube event display durations often overlap.
    let low = 0;
    let high = transcriptChunks.length - 1;
    let result = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const first = transcriptData!.segments[transcriptChunks[middle].targetStart];
      if (first.start <= time) { result = middle; low = middle + 1; }
      else high = middle - 1;
    }
    return result;
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
    panel.setCurrentSectionTranslated(isChunkTranslated(chunk));
    panel.setAllSectionsTranslated(transcriptChunks.every(isChunkTranslated));
    panel.setTranscriptView(transcriptView);
    panel.setTranslationProgress(localizedText(translationProgressMessage));
  }

  function renderTranscriptReader(panel: Panel, preserveScroll: boolean = true): void {
    if (!transcriptData || !transcriptChunks.length) return;
    const content = panel.getContentElement();
    const previousTop = preserveScroll ? transcriptScrollTop : content.scrollTop;
    const anchor = preserveScroll ? content.querySelector<HTMLElement>(`[data-chunk-id="${activeChunkId}"]`) : null;
    const anchorTop = anchor?.getBoundingClientRect().top;
    renderTranscriptSections(content, transcriptData, {
      chunks: transcriptChunks,
      loadedStart: loadedChunkStart,
      loadedEnd: loadedChunkEnd,
      activeChunkId,
      view: transcriptView,
      translations: translatedSections,
      withTimestamps: transcriptWithTimestamps,
    });
    if (preserveScroll) {
      const nextAnchor = content.querySelector<HTMLElement>(`[data-chunk-id="${activeChunkId}"]`);
      const delta = anchorTop !== undefined && nextAnchor ? nextAnchor.getBoundingClientRect().top - anchorTop : 0;
      content.scrollTop = previousTop + delta;
      transcriptScrollTop = content.scrollTop;
    }
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

  function handleTranscriptWheel(panel: Panel, event: WheelEvent): void {
    if (panel.getMode() !== "transcript" || !transcriptChunks.length) return;
    const content = panel.getContentElement();
    const direction = getTranscriptLazyLoadDirection({
      deltaY: event.deltaY,
      scrollTop: content.scrollTop,
      clientHeight: content.clientHeight,
      scrollHeight: content.scrollHeight,
      loadedStart: loadedChunkStart,
      loadedEnd: loadedChunkEnd,
      totalChunks: transcriptChunks.length,
    });
    if (!direction) return;

    event.preventDefault();
    event.stopPropagation();
    const oldHeight = content.scrollHeight;
    const oldTop = content.scrollTop;
    if (direction === "after") loadedChunkEnd += 1;
    else loadedChunkStart -= 1;
    renderTranscriptReader(panel, false);

    const addedHeight = content.scrollHeight - oldHeight;
    const nextTop = direction === "after"
      ? oldTop + Math.max(1, event.deltaY)
      : oldTop + addedHeight + Math.min(-1, event.deltaY);
    content.scrollTop = Math.max(
      0,
      Math.min(content.scrollHeight - content.clientHeight, nextTop),
    );
    transcriptScrollTop = content.scrollTop;
    updateActiveChunkFromScroll(panel);
  }

  async function ensureTranslationCache(
    expectedVersion: number = transcriptStateVersion,
  ): Promise<TranslationCacheIdentity> {
    if (translationCacheReset?.videoId === extractor.getVideoId()) {
      await translationCacheReset.task;
    }
    const cacheRevision = translationCacheRevision;
    const assertCurrent = () => {
      if (expectedVersion !== transcriptStateVersion || cacheRevision !== translationCacheRevision) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
    };
    assertCurrent();
    const transcript = transcriptData!;
    const ai = await getActiveAIIdentity();
    assertCurrent();
    const fingerprint = transcriptFingerprint ??= fingerprintCaptionSource(transcript);
    const identity: TranslationCacheIdentity = {
      videoId: extractor.getVideoId(),
      sourceLanguage: transcript.languageCode,
      providerId: ai.providerId,
      modelId: ai.modelId,
      targetLanguage: outputLanguage,
      sourceFingerprint: `${await fingerprint}:${translationChunkPreset}`,
    };
    assertCurrent();
    // Custom instructions intentionally do not participate in cache identity.
    // Users opt into new wording through the explicit retranslation actions.
    const key = JSON.stringify(identity);
    if (translationIdentityKey !== key) {
      if (cacheLoad?.key === key && cacheLoad.version === expectedVersion && cacheLoad.revision === cacheRevision) {
        await cacheLoad.task;
        assertCurrent();
        return identity;
      }
      translatedSections = {};
      const task = (async () => {
        const cached = await getCachedTranslation(identity);
        assertCurrent();
        for (const section of Object.values(cached?.sections ?? {})) {
          const chunk = transcriptChunks[section.chunkId];
          if (!chunk || chunk.targetStart !== section.targetStart || chunk.targetEnd !== section.targetEnd) continue;
          try {
            const aligned = alignTranslatedParts(transcript, chunk, section.segments.map((segment) => ({
              source: segment.sourceText, translation: segment.text,
            })));
            // Reconstruct observed times rather than trusting persistent timestamps.
            translatedSections[chunk.id] = aligned;
          } catch {
            // Invalid coverage or timing invalidates the whole section.
          }
        }
        translationIdentityKey = key;
      })();
      cacheLoad = { key, version: expectedVersion, revision: cacheRevision, task };
      try { await task; }
      finally { if (cacheLoad?.task === task) cacheLoad = null; }
    }
    return identity;
  }

  function mountPanel(target: HTMLElement): Panel {
    playerOnboarding.destroy();
    currentPanel?.destroy();
    const panel = new Panel(callbacks);
    currentPanel = panel;
    panel.getContentElement().addEventListener(
      "scroll",
      () => handleTranscriptScroll(panel),
      { passive: true },
    );
    panel.getContentElement().addEventListener(
      "wheel",
      (event) => handleTranscriptWheel(panel, event),
      { passive: false },
    );
    panel.setTranslationAvailable(true);
    panel.setTranslationCacheClearing(translationCacheReset?.videoId === extractor.getVideoId());
    const title = extractor.getVideoTitle();
    if (title) panel.setTitle(title);
    panel.setTheme(isYouTubeDarkMode());
    panel.setAIAvailable(aiSetupStatus.hasKey, aiSetupStatus.providerName);
    panel.injectTrigger(target);
    panel.bindToPlayer(target);
    panel.injectPanel(document.body);
    playerTranslationToggle.mount(target);
    playerTranslationToggle.setEnabled(bilingualEnabled);
    playerTranslationToggle.setAvailable(aiSetupStatus.hasKey);
    void panel.initPanelWidth();
    playerOnboarding.start();
    if (bilingualEnabled && aiSetupStatus.hasKey) void activateBilingualOverlay(target);
    return panel;
  }

  function getPanel(): Panel {
    if (!currentPanel || !document.getElementById("vas-root")) {
      return mountPanel(config.findInjectTarget() || document.body);
    }
    return currentPanel;
  }

  function isChunkTranslated(chunk: TranslationChunk): boolean {
    return Boolean(translatedSections[chunk.id]?.length);
  }

  async function persistTranslationSectionSafely(
    identity: TranslationCacheIdentity, chunk: TranslationChunk, segments: TranslatedSegment[],
  ): Promise<void> {
    try {
      await setCachedTranslationSection(identity, {
        chunkId: chunk.id, targetStart: chunk.targetStart, targetEnd: chunk.targetEnd, segments,
      });
    } catch (error) {
      console.debug("[vas] Translation cache write failed:", error);
      if (currentPanel?.getMode() === "transcript") currentPanel.showWarning(t("translationCacheWriteFailed"));
    }
  }

  function renderTranslationConsumers(): void {
    const panel = currentPanel;
    if (panel?.getMode() === "transcript") renderTranscriptReader(panel);
    syncBilingualOverlay();
  }

  function resetVideoTranslationCache(): void {
    const videoId = extractor.getVideoId();
    if (!videoId || !transcriptData || translationCacheReset) return;
    let stateVersion = transcriptStateVersion;
    const pendingWorker = translationTask;
    const reset = { videoId, task: Promise.resolve() };
    // Block prefetch before aborting: worker cleanup also renders the overlay.
    translationCacheReset = reset;
    translationCacheRevision += 1;
    translationJobs = [];
    fullTranslationRequested = false;
    translationAbort?.abort();
    currentPanel?.setTranslationCacheClearing(true);
    translationProgressMessage = { key: "clearingTranslationCache" };
    currentPanel?.setTranslationProgress(localizedText(translationProgressMessage));
    const isCurrent = () => stateVersion === transcriptStateVersion &&
      videoId === extractor.getVideoId();

    let cacheCleared = false;
    reset.task = (async () => {
      try {
        // A storage write already started by the old worker must finish BEFORE
        // removal, or its completion could resurrect the translation we cleared.
        await pendingWorker?.catch((error) => {
          console.debug("[vas] Translation worker stopped during cache reset:", error);
        });
        await clearVideoTranslationCache(videoId);
        await extractor.clearTranscriptCache?.(videoId);
        if (!isCurrent()) return;
        clearTranscriptState();
        stateVersion = transcriptStateVersion;
        cacheCleared = true;
        const panel = currentPanel!;
        panel.reset();
        panel.setMode("loading");
        panel.setLoadingMessage("fetchingTranscript");
        const transcript = await ensureTranscript(panel, stateVersion);
        if (!isCurrent()) return;
        transcriptChunks = buildConfiguredTranslationChunks(transcript);
        activeChunkId = findChunkAtTime(getCurrentPlaybackTime());
        loadedChunkStart = Math.max(0, activeChunkId - 1);
        loadedChunkEnd = Math.min(transcriptChunks.length - 1, activeChunkId + 1);
        panel.setMode("transcript");
        panel.setTranslationAvailable(!isTranscriptInOutputLanguage(transcript.languageCode, outputLanguage));
        translatedSections = {};
        translationIdentityKey = "";
        autoTranslationErrors = {};
        autoTranslationBlockedMessage = "";
        translationProgressMessage = { key: "translationCacheCleared" };
      } catch (error) {
        console.debug("[vas] Translation cache reset failed:", error);
        if (isCurrent()) {
          translationProgressMessage = { key: cacheCleared ? "translationCacheCleared" : "translationCacheClearFailed" };
          if (cacheCleared) {
            currentPanel?.reset();
            currentPanel?.showError(error instanceof Error ? error.message : t("errorYoutubeCaptionUnavailable"));
          } else currentPanel?.showWarning(t("translationCacheClearFailed"));
        }
      } finally {
        if (translationCacheReset === reset) translationCacheReset = null;
        if (isCurrent()) {
          currentPanel?.setTranslationCacheClearing(false);
          currentPanel?.setTranslationProgress(localizedText(translationProgressMessage));
          // Enabled bilingual captions request fresh translations at playback;
          // the reader offers Translate section / Translate all again.
          renderTranslationConsumers();
          if (cacheCleared && transcriptData && bilingualEnabled) void activateBilingualOverlay();
        }
      }
    })();
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

    const chunks = transcriptChunks.filter((chunk) =>
      chunk.targetEnd >= job.targetStart && chunk.targetStart <= job.targetEnd);
    for (const chunk of chunks) {
      assertCurrent();
      if (!job.forceRefresh && isChunkTranslated(chunk)) continue;
      if (job.forceRefresh) {
        await invalidateTranslationSection(identity, chunk.id);
        assertCurrent();
      }
      const requestStart = performance.now();
      const result = await translateTranscriptChunk(
        transcript, chunk, identity.targetLanguage,
        (_partial, formatRetry) => {
          if (controller.signal.aborted || stateVersion !== transcriptStateVersion) return;
          if (formatRetry && job.sectionId !== undefined) {
            translationProgressMessage = { key: "repairingSectionFormat", substitutions: String(chunk.id + 1) };
            currentPanel?.setTranslationProgress(localizedText(translationProgressMessage));
          }
        }, controller.signal, job.customInstruction ?? "", {
          videoId: identity.videoId, providerId: identity.providerId, modelId: identity.modelId,
        },
      );
      assertCurrent();
      recentCaptionTranslationMs = [...recentCaptionTranslationMs, performance.now() - requestStart].slice(-3);
      // Whole-block commit: partial / retried output never changes playback or disk.
      translatedSections[chunk.id] = result;
      delete autoTranslationErrors[chunk.id];
      renderTranslationConsumers();
      await persistTranslationSectionSafely(identity, chunk, result);
      assertCurrent();
    }
    if (job.kind !== "overlay") autoTranslationBlockedMessage = "";
  }

  function enqueueTranslationJob(job: TranslationJob): void {
    if (translationCacheReset?.videoId === extractor.getVideoId()) return;
    if (!transcriptData || job.targetStart > job.targetEnd) return;
    job.customInstruction ??= activeCustomPromptInstruction;
    const alreadyCurrent = !translationAbort?.signal.aborted && currentTranslationJob &&
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
      const playbackChunk = transcriptChunks[findChunkAtTime(getCurrentPlaybackTime())];
      const servesPlayback = playbackChunk && job.targetStart <= playbackChunk.targetEnd && job.targetEnd >= playbackChunk.targetStart;
      if (
        currentTranslationJob?.kind === "overlay" &&
        servesPlayback &&
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
    if (translationCacheReset?.videoId === extractor.getVideoId()) return;
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
          const completed = job.forceRefresh
            ? (job.sectionId ?? 0)
            : transcriptChunks.filter(isChunkTranslated).length;
          translationProgressMessage = {
            key: "translatingAllProgress",
            substitutions: [String(completed), String(transcriptChunks.length)],
          };
        } else if (job.kind === "section" && job.sectionId !== undefined) {
          translationProgressMessage = {
            key: "translatingSectionProgress",
            substitutions: [String(job.sectionId + 1), String(transcriptChunks.length)],
          };
        }
        panel.setTranslationProgress(localizedText(translationProgressMessage));

        try {
          await processTranslationJob(job, controller, stateVersion);
          bilingualOverlay?.setSourceReady(true);
          if (job.kind === "section") {
            translationProgressMessage = { key: "translationSectionDone" };
          }
        } catch (error) {
          if ((error as Error)?.name !== "AbortError" && !controller.signal.aborted && stateVersion === transcriptStateVersion) {
            const message = error instanceof Error ? error.message : t("translationFailed");
            if (job.kind === "overlay") {
              autoTranslationBlockedMessage = message;
              for (const chunk of transcriptChunks) {
                if (chunk.targetEnd >= job.targetStart && chunk.targetStart <= job.targetEnd && !isChunkTranslated(chunk)) {
                  autoTranslationErrors[chunk.id] = message;
                }
              }
              if ((error as Error)?.name === "NoApiKeyError") {
                bilingualOverlay?.setSourceReady(false);
              }
            } else {
              translationProgressMessage = {
                key: "translationStopped",
                substitutions: message,
              };
              translationJobs = translationJobs.filter((queued) => queued.kind === "overlay");
              fullTranslationRequested = false;
              if (panel.getMode() === "transcript") panel.showWarning(message);
            }
            const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
            console.debug("[vas] Translation stopped:", detail);
          }
        } finally {
          if (translationAbort === controller) {
            currentTranslationJob = null;
            translationAbort = null;
            renderTranslationConsumers();
          }
        }
      }
      if (stateVersion === transcriptStateVersion) {
        if (fullTranslationRequested && transcriptChunks.every(isChunkTranslated)) {
          translationProgressMessage = { key: "translationAllDone" };
        }
        fullTranslationRequested = false;
      }
    })().finally(() => {
      if (translationTask !== task) return;
      translationTask = null;
      translationAbort = null;
      currentTranslationJob = null;
      panel.setTranslationActionsBusy(false);
      panel.setTranslationProgress(localizedText(translationProgressMessage));
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
    if (translationCacheReset?.videoId === extractor.getVideoId()) return;
    if (!aiSetupStatus.hasKey) {
      panel.setAIAvailable(false, aiSetupStatus.providerName);
      return;
    }
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
      translationProgressMessage = {
        key: isFullTranslation ? "translationAllAlreadyDone" : "translationSectionAlreadyDone",
      };
      panel.setTranslationProgress(localizedText(translationProgressMessage));
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

  function maybeQueueOverlayPrefetch(): void {
    if (translationCacheReset?.videoId === extractor.getVideoId() || !transcriptData ||
      fullTranslationRequested || autoTranslationBlockedMessage ||
      isTranscriptInOutputLanguage(transcriptData.languageCode, outputLanguage)) return;
    const time = getCurrentPlaybackTime();
    const current = findChunkAtTime(time);
    const chunk = getOverlayPrefetchChunk(transcriptData.segments, transcriptChunks, current, time,
      isChunkTranslated, bilingualVideo?.playbackRate ?? 1, recentCaptionTranslationMs);
    if (!chunk || autoTranslationErrors[chunk.id]) return;
    enqueueTranslationJob({ kind: "overlay", targetStart: chunk.targetStart, targetEnd: chunk.targetEnd,
      sectionId: chunk.id, forceRefresh: false });
  }

  function retryBilingualTranslation(): void {
    if (!bilingualOverlay || !transcriptData || !bilingualEnabled) return;
    const chunk = transcriptChunks[findChunkAtTime(getCurrentPlaybackTime())];
    if (!chunk) return;
    autoTranslationBlockedMessage = "";
    delete autoTranslationErrors[chunk.id];
    bilingualOverlay.setSourceReady(true);
    enqueueTranslationJob({ kind: "overlay", targetStart: chunk.targetStart, targetEnd: chunk.targetEnd,
      sectionId: chunk.id, forceRefresh: true });
  }

  function syncBilingualOverlay(playbackTime: number = getCurrentPlaybackTime()): void {
    if (!bilingualOverlay || !transcriptData || !bilingualEnabled) return;
    const chunk = transcriptChunks[findChunkAtTime(playbackTime)];
    const aligned = chunk ? translatedSections[chunk.id] : undefined;
    const translatedIndex = aligned ? findActiveCueIndex(aligned, playbackTime) : -1;
    const translated = translatedIndex >= 0 ? aligned![translatedIndex] : undefined;
    const rawIndex = findActiveCueIndex(transcriptData.segments, playbackTime);
    const raw = rawIndex >= 0 ? transcriptData.segments[rawIndex] : undefined;
    // A committed section's gaps stay gaps; don't show a raw rolling cue over them.
    const sourceText = aligned ? translated?.sourceText : raw?.text;
    if (!sourceText) {
      bilingualOverlay.setCue(null);
      maybeQueueOverlayPrefetch();
      return;
    }
    const translationNeeded = !isTranscriptInOutputLanguage(transcriptData.languageCode, outputLanguage);
    const errorText = translationNeeded && !translated
      ? (autoTranslationErrors[chunk?.id ?? -1] || autoTranslationBlockedMessage) : "";
    bilingualOverlay.setCue({ sourceText,
      translationText: translationNeeded ? translated?.text : undefined,
      statusText: translationNeeded && !translated ? (errorText || t("bilingualTranslating")) : undefined,
      retryText: errorText ? t("bilingualRetry") : undefined,
    });
    if (translationNeeded) maybeQueueOverlayPrefetch();
  }

  async function activateBilingualOverlay(preferredPlayer?: HTMLElement): Promise<void> {
    if (!bilingualEnabled || !aiSetupStatus.hasKey || !extractor.isOnVideoPage()) return;
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
    overlay.setLearningMode(learningModeEnabled);
    overlay.setTranslationOnly(translationOnlyEnabled);
    overlay.setStyle(subtitleStyle);
    playerTranslationToggle.mount(player);
    playerTranslationToggle.setEnabled(bilingualEnabled);
    overlay.setCue({ sourceText: t("fetchingTranscript") });
    const stateVersion = transcriptStateVersion;
    try {
      const transcript = await ensureTranscript(getPanel(), stateVersion);
      if (!bilingualEnabled || bilingualOverlay !== overlay || stateVersion !== transcriptStateVersion) return;
      if (!transcriptChunks.length) transcriptChunks = buildConfiguredTranslationChunks(transcript);
      if (!isTranscriptInOutputLanguage(transcript.languageCode, outputLanguage)) {
        await ensureTranslationCache(stateVersion);
      }
      if (!bilingualEnabled || bilingualOverlay !== overlay || stateVersion !== transcriptStateVersion) return;
      overlay.setSourceReady(true);
      const video = player.querySelector("video") ?? document.querySelector("video");
      if (video) {
        bilingualVideo = video;
        bilingualSyncHandler = () => syncBilingualOverlay();
        for (const event of ["timeupdate", "seeking", "seeked", "loadedmetadata", "play", "ratechange"]) {
          video.addEventListener(event, bilingualSyncHandler, { passive: true });
        }
        if (typeof video.requestVideoFrameCallback === "function") {
          const syncVideoFrame: VideoFrameRequestCallback = (_now, metadata) => {
            if (bilingualVideo !== video || bilingualOverlay !== overlay || !bilingualEnabled) return;
            const frameChunk = transcriptChunks[findChunkAtTime(metadata.mediaTime)];
            const frameSegments = translatedSections[frameChunk?.id] ?? transcriptData?.segments ?? [];
            const frameCueId = `${frameChunk?.id}:${findActiveCueIndex(frameSegments, metadata.mediaTime)}:${Boolean(translatedSections[frameChunk?.id])}`;
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
      // Only caption failures can be fixed by captions appearing later.
      if (!transcriptData) {
        captionRecovery = { videoId: extractor.getVideoId(), overlay, player };
      }
    }
  }

  // ── Callbacks ──────────────────────────────────────────────────────
  const callbacks = {
    onSummarize: async () => {
      const panel = getPanel();

      // 字幕视图会复用内容容器，但总结仍保存在内存中。此时“AI 总结”
      // 是返回总结视图的入口；只有已处于总结视图时，点击才会强制刷新。
      if (
        panel.getMode() !== "summary" &&
        displayedSummary?.text.trim() &&
        displayedSummary.videoId === extractor.getVideoId() &&
        displayedSummary.outputLanguage === outputLanguage
      ) {
        panel.setTitle(displayedSummary.videoTitle || extractor.getVideoTitle());
        panel.setContent(renderMarkdown(displayedSummary.text));
        showSummaryTranslationAction(panel, displayedSummary);
        panel.setMode("summary");
        panel.setCachedView(true);
        panel.open();
        return;
      }

      if (!aiSetupStatus.hasKey) {
        panel.setAIAvailable(false, aiSetupStatus.providerName);
        return;
      }
      const requestedLanguage = outputLanguage;
      const customInstruction = activeCustomPromptInstruction;
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
          panel.hideCacheHint();
        }

        // Custom instructions intentionally do not change the summary cache key;
        // "Summarize again" is the explicit refresh path after switching presets.
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
        panel.setLoadingMessage("fetchingTranscript");
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
        panel.setLoadingMessage("generatingSummary");

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
          customInstruction,
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
        if (captionPreferenceChangePending && !summaryAbort) applyCaptionPreferenceChange();
      }
    },

    onTranslateSummary: async () => {
      const sourceSummary = displayedSummary;
      if (!sourceSummary?.text.trim() || summaryTranslationAbort) return;

      const panel = getPanel();
      if (!aiSetupStatus.hasKey) {
        panel.setAIAvailable(false, aiSetupStatus.providerName);
        return;
      }
      const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const controller = new AbortController();
      const customInstruction = activeCustomPromptInstruction;
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
          customInstruction,
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
      const shouldSyncToPlayback = panel.getMode() !== "transcript";
      summaryTranslationAbort?.abort();
      summaryTranslationAbort = null;
      const stateVersion = transcriptStateVersion;
      panel.setMode("loading");
      panel.setLoadingMessage("fetchingTranscript");
      panel.open();

      try {
        const transcript = await ensureTranscript(panel, stateVersion);
        panel.setTitle(extractor.getVideoTitle());
        transcriptWithTimestamps = withTimestamps;
        if (!transcriptChunks.length) {
          transcriptChunks = buildConfiguredTranslationChunks(transcript);
        }
        if (shouldSyncToPlayback) {
          activeChunkId = findChunkAtTime(getCurrentPlaybackTime());
          loadedChunkStart = Math.max(0, activeChunkId - 1);
          loadedChunkEnd = Math.min(transcriptChunks.length - 1, activeChunkId + 1);
        }
        if (!isTranscriptInOutputLanguage(transcript.languageCode, outputLanguage)) {
          await ensureTranslationCache(stateVersion);
        }
        panel.setMode("transcript");
        panel.setTranslationAvailable(
          !isTranscriptInOutputLanguage(transcript.languageCode, outputLanguage),
        );
        panel.setTranslationActionsBusy(Boolean(translationTask));
        renderTranscriptReader(panel, !shouldSyncToPlayback);
        if (shouldSyncToPlayback) {
          const targetChunkId = activeChunkId;
          requestAnimationFrame(() => {
            if (
              stateVersion !== transcriptStateVersion ||
              currentPanel !== panel ||
              panel.getMode() !== "transcript"
            ) return;
            const content = panel.getContentElement();
            const active = content.querySelector<HTMLElement>(
              `[data-chunk-id="${targetChunkId}"]`,
            );
            if (active) {
              const contentRect = content.getBoundingClientRect();
              const activeRect = active.getBoundingClientRect();
              content.scrollTop = getTranscriptTargetScrollTop({
                scrollTop: content.scrollTop,
                clientHeight: content.clientHeight,
                scrollHeight: content.scrollHeight,
                containerTop: contentRect.top,
                targetTop: activeRect.top,
                targetHeight: activeRect.height,
              });
              transcriptScrollTop = content.scrollTop;
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

    onTranslateAll: (forceRefresh: boolean) => {
      runTranslationQueue(
        getPanel(),
        transcriptChunks.map((chunk) => chunk.id),
        forceRefresh,
        true,
      );
    },

    onClearTranslationCache: () => resetVideoTranslationCache(),
    onExportCaptionDiagnostics: () => {
      const videoId = extractor.getVideoId();
      if (videoId) void downloadCaptionDiagnostics(videoId).catch((error) => console.debug("[vas] Caption diagnostic export failed", error));
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
    playerOnboarding.destroy();
    destroyBilingualOverlay();
    playerTranslationToggle.destroy();
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
      if (vasRoot && bilingualEnabled && aiSetupStatus.hasKey && !overlayInDom) {
        void activateBilingualOverlay();
      }
    }, delay);
  });

  // ── SPA navigation: inject on enter, destroy on leave ──────────────
  watchNavigation(() => {
    playerOnboarding.destroy();
    clearTranscriptState();
    if (extractor.isOnVideoPage()) {
      restoreBilingualEnabledForCurrentVideo();
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
          const t = extractor.getVideoTitle();
          if (t) p.setTitle(t);
          p.setTheme(isYouTubeDarkMode());

          // Re-inject trigger if YouTube rebuilt the player
          if (!p.getTrigger().parentNode) {
            const newTarget = config.findInjectTarget() || document.body;
            p.injectTrigger(newTarget);
            p.bindToPlayer(newTarget);
            playerTranslationToggle.mount(newTarget);
          }
          if (bilingualEnabled && aiSetupStatus.hasKey) void activateBilingualOverlay();
          playerOnboarding.start();
        }, 800);
      }
    } else {
      // Left the video page
      destroyPanel();
    }
  });
}
