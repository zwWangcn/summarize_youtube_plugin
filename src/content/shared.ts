/**
 * YouTube 内容脚本的装配与编排。
 *
 * 状态归属：
 * - SummaryController：AI 总结与总结翻译
 * - CaptionSession：字幕、分块、译文、翻译缓存与翻译队列
 * - TranscriptReader：侧栏字幕阅读器的位置与视图
 * - BilingualController：播放器双语字幕
 * - ChatController：针对视频内容的追问
 * 本文件只负责创建它们、响应设置变化、挂载面板以及 SPA 注入/导航。
 */

import { normalizeCaptionLanguage } from "../utils/caption-language";
import { downloadCaptionDiagnostics } from "../service/caption-diagnostics";
import { Panel, type TranscriptView } from "./ui/panel";
import { PlayerOnboarding } from "./ui/player-onboarding";
import type { Transcript } from "./transcript";
import { isTranscriptInOutputLanguage } from "./transcript";
import {
  CUSTOM_PROMPT_STORAGE_PREFIX,
  getCustomPromptProfile,
  getSettings,
} from "../service/storage";
import { normalizeSubtitleStyle } from "../service/subtitle-style";
import { isTranslationChunkPreset, type TranslationChunkPreset } from "../service/ai-controls";
import {
  activateUiLanguage,
  getUiLocale,
  isOutputLanguage,
  isUiLanguage,
  type OutputLanguage,
  type UiLanguage,
} from "../utils/i18n";
import { logI18nDebug } from "../utils/i18n-debug";
import { resolveAISelection } from "../service/model-registry";
import type { ContentScriptConfig, Extractor } from "./content-types";
import {
  isYouTubeDarkMode,
  requestAISetupStatus,
  seekPlayer,
  waitForTarget,
  watchNavigation,
} from "./page";
import { SummaryController } from "./summary-controller";
import { CaptionSession } from "./caption-session";
import { TranscriptReader } from "./transcript-reader";
import { BilingualController } from "./bilingual-controller";
import { ChatController } from "./chat-controller";

export type { ContentScriptConfig, Extractor } from "./content-types";
export { findYouTubeTarget, watchNavigation } from "./page";

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
  let preferredCaptionLanguage = normalizeCaptionLanguage(initialSettings.preferredCaptionLanguage);
  let captionPreferenceChangePending = false;
  let currentPanel: Panel | null = null;
  logI18nDebug("content initialized", {
    chromeUiLocale: getUiLocale(),
    outputLanguage,
    providerId: initialSettings.provider,
    modelId: initialSettings.model,
  });

  // ── Controllers ────────────────────────────────────────────────────
  const getOutputLanguage = () => outputLanguage;
  const getAISetupStatus = () => aiSetupStatus;

  const session = new CaptionSession({
    extractor,
    getPanel: () => getPanel(),
    currentPanel: () => currentPanel,
    getOutputLanguage,
    getCustomInstruction: () => activeCustomPromptInstruction,
    getPreferredCaptionLanguage: () => preferredCaptionLanguage,
    getChunkPreset: () => translationChunkPreset,
    getAISetupStatus,
    renderTranslationConsumers: () => renderTranslationConsumers(),
    setOverlaySourceReady: (ready) => bilingual.setSourceReady(ready),
    clearForReload: () => clearTranscriptState(),
    onSourceReloaded: (panel, transcript) => {
      reader.syncToPlayback();
      panel.setMode("transcript");
      panel.setTranslationAvailable(!isTranscriptInOutputLanguage(transcript.languageCode, outputLanguage));
    },
    onReloadFinished: () => {
      if (bilingual.isEnabled()) void bilingual.activate();
    },
  });
  const reader = new TranscriptReader(session, {
    extractor,
    getPanel: () => getPanel(),
    currentPanel: () => currentPanel,
    getOutputLanguage,
    onShow: () => summary.abortTranslation(),
  });
  const bilingual = new BilingualController(session, {
    extractor,
    config,
    getPanel: () => getPanel(),
    getOutputLanguage,
    getAISetupStatus,
  }, {
    // Per-video choices live for this content-script lifetime and override the synced default.
    defaultEnabled: initialSettings.bilingualSubtitlesDefaultEnabled,
    learningMode: initialSettings.learningModeEnabled,
    translationOnly: initialSettings.translationOnlyEnabled,
    style: initialSettings.subtitleStyle,
  });
  const summary = new SummaryController({
    extractor,
    getPanel: () => getPanel(),
    ensureTranscript: (panel: Panel): Promise<Transcript> => session.ensureTranscript(panel),
    getOutputLanguage,
    getCustomInstruction: () => activeCustomPromptInstruction,
    getAISetupStatus,
    onIdle: () => {
      if (captionPreferenceChangePending) applyCaptionPreferenceChange();
    },
  });
  const chat = new ChatController({
    extractor,
    getPanel: () => getPanel(),
    currentPanel: () => currentPanel,
    ensureTranscript: (panel: Panel): Promise<Transcript> => session.ensureTranscript(panel),
    getOutputLanguage,
    getCustomInstruction: () => activeCustomPromptInstruction,
    getAISetupStatus,
  });
  extractor.onCaptionsAvailable?.((videoId) => bilingual.onCaptionsAvailable(videoId));

  const playerOnboarding = new PlayerOnboarding({
    getPlayer: config.findInjectTarget,
    getSummaryButton: () => currentPanel?.getTrigger() ?? null,
    getPanelToolbar: () => currentPanel?.getPanelContainer().shadowRoot?.querySelector<HTMLElement>(".vas-toolbar") ?? null,
    getSubtitleButton: () => bilingual.toggle.getButton(),
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

  // ── Cross-controller operations ────────────────────────────────────
  function renderTranslationConsumers(): void {
    reader.renderIfVisible();
    bilingual.sync();
  }

  /** Captions of the current video are no longer valid. */
  function clearSourceState(): void {
    session.clear();
    chat.invalidateContext();
    bilingual.clearRecovery();
    reader.reset();
    bilingual.destroy();
  }

  /** Navigation / output language: everything belongs to the previous state. */
  function clearTranscriptState(): void {
    clearSourceState();
    summary.reset();
    chat.reset();
  }

  /**
   * A caption-source change (preferred language) invalidates captions,
   * segmentation and translations, but not a summary of the same video.
   * While a summary is running it is deferred: bumping the state version would
   * abort its transcript fetch silently and leave the panel loading forever.
   */
  function applyCaptionPreferenceChange(): void {
    if (summary.isRunning()) {
      captionPreferenceChangePending = true;
      return;
    }
    captionPreferenceChangePending = false;
    clearSourceState();
    if (currentPanel?.getMode() === "transcript") currentPanel.reset();
    if (bilingual.isEnabled()) void bilingual.activate();
  }

  function renderAISetupAvailability(): void {
    currentPanel?.setAIAvailable(aiSetupStatus.hasKey, aiSetupStatus.providerName);
    bilingual.toggle.setAvailable(aiSetupStatus.hasKey);
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
      summary.abort();
      chat.abort();
      session.stopForMissingKey();
      bilingual.destroy();
      return;
    }
    if (providerChanged) bilingual.destroy();
    if ((forceOverlay || !previous.hasKey || providerChanged) && bilingual.isEnabled() && extractor.isOnVideoPage()) {
      session.clearAutoErrors();
      void bilingual.activate();
    }
  }

  async function refreshActiveCustomPrompt(): Promise<void> {
    const profile = await getCustomPromptProfile(activeCustomPromptId);
    if (activeCustomPromptId === profile?.id) {
      activeCustomPromptInstruction = profile.instruction;
    } else if (!profile) {
      activeCustomPromptInstruction = "";
    }
  }

  // ── Settings changes ───────────────────────────────────────────────
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
      if (session.invalidateForChunkPreset()) {
        reader.syncToPlayback();
        reader.renderIfVisible(false);
        bilingual.sync();
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
        bilingual.toggle.refreshLocalizedText();
        playerOnboarding.refreshLocalizedText();
        if (currentPanel?.getMode() === "transcript") {
          reader.render(currentPanel);
        } else if (currentPanel?.getMode() === "chat") {
          chat.refreshLocalizedText();
        } else if (currentPanel) {
          currentPanel.setTranslationProgress(session.progressText);
          summary.refreshLocalizedText(currentPanel);
        }
        bilingual.sync();
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
      if (bilingual.isEnabled() && aiSetupStatus.hasKey && extractor.isOnVideoPage()) {
        void bilingual.activate();
      }
    }

    const nextLearningMode = changes.learningModeEnabled?.newValue;
    if (typeof nextLearningMode === "boolean") bilingual.setLearningMode(nextLearningMode);

    const nextTranslationOnly = changes.translationOnlyEnabled?.newValue;
    if (typeof nextTranslationOnly === "boolean") bilingual.setTranslationOnly(nextTranslationOnly);

    const nextBilingualDefault = changes.bilingualSubtitlesDefaultEnabled?.newValue;
    if (typeof nextBilingualDefault === "boolean") bilingual.setDefaultEnabled(nextBilingualDefault);

    if (changes.subtitleStyle) {
      bilingual.setStyle(normalizeSubtitleStyle(changes.subtitleStyle.newValue));
    }

    if (changes.provider || changes.model) {
      session.invalidateForModelChange();
      chat.invalidateContext();
      renderTranslationConsumers();
      void refreshAISetupAvailability(true);
    }
  });

  // ── Panel ──────────────────────────────────────────────────────────
  const callbacks = {
    onSummarize: () => summary.summarize(),
    onTranslateSummary: () => summary.translate(),
    onTranscript: (withTimestamps: boolean) => reader.show(withTimestamps),
    onAsk: () => chat.open(),
    onAskSubmit: (question: string) => { void chat.ask(question); },
    onAskNewChat: () => chat.newChat(),
    onTranscriptViewChange: (view: TranscriptView) => reader.setView(view),
    onTranslateCurrent: (forceRefresh: boolean) => reader.translateCurrent(forceRefresh),
    onTranslateAll: (forceRefresh: boolean) => reader.translateAll(forceRefresh),
    onClearTranslationCache: () => session.resetVideoCache(),
    onExportCaptionDiagnostics: () => {
      const videoId = extractor.getVideoId();
      if (videoId) void downloadCaptionDiagnostics(videoId).catch((error) => console.debug("[vas] Caption diagnostic export failed", error));
    },
    onClose: () => {
      summary.abort();
      chat.abort();
      session.dropReaderJobs();
    },
    onSeek: (seconds: number) => seekPlayer(seconds),
  };

  function mountPanel(target: HTMLElement): Panel {
    playerOnboarding.destroy();
    currentPanel?.destroy();
    const panel = new Panel(callbacks);
    currentPanel = panel;
    reader.attach(panel);
    panel.setTranslationAvailable(true);
    panel.setTranslationCacheClearing(session.isCacheResetting(extractor.getVideoId()));
    const title = extractor.getVideoTitle();
    if (title) panel.setTitle(title);
    panel.setTheme(isYouTubeDarkMode());
    panel.setAIAvailable(aiSetupStatus.hasKey, aiSetupStatus.providerName);
    panel.injectTrigger(target);
    panel.bindToPlayer(target);
    panel.injectPanel(document.body);
    bilingual.toggle.mount(target);
    bilingual.toggle.setEnabled(bilingual.isEnabled());
    bilingual.toggle.setAvailable(aiSetupStatus.hasKey);
    void panel.initPanelWidth();
    playerOnboarding.start();
    if (bilingual.isEnabled() && aiSetupStatus.hasKey) void bilingual.activate(target);
    return panel;
  }

  function getPanel(): Panel {
    if (!currentPanel || !document.getElementById("vas-root")) {
      return mountPanel(config.findInjectTarget() || document.body);
    }
    return currentPanel;
  }

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
    bilingual.destroy();
    bilingual.toggle.destroy();
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
      if (vasRoot && bilingual.isEnabled() && aiSetupStatus.hasKey && !overlayInDom) {
        void bilingual.activate();
      }
    }, delay);
  });

  // ── SPA navigation: inject on enter, destroy on leave ──────────────
  watchNavigation(() => {
    playerOnboarding.destroy();
    clearTranscriptState();
    if (extractor.isOnVideoPage()) {
      bilingual.restoreForCurrentVideo();
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
          const title = extractor.getVideoTitle();
          if (title) p.setTitle(title);
          p.setTheme(isYouTubeDarkMode());

          // Re-inject trigger if YouTube rebuilt the player
          if (!p.getTrigger().parentNode) {
            const newTarget = config.findInjectTarget() || document.body;
            p.injectTrigger(newTarget);
            p.bindToPlayer(newTarget);
            bilingual.toggle.mount(newTarget);
          }
          if (bilingual.isEnabled() && aiSetupStatus.hasKey) void bilingual.activate();
          playerOnboarding.start();
        }, 800);
      }
    } else {
      // Left the video page
      destroyPanel();
    }
  });
}
