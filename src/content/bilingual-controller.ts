/** In-player bilingual subtitles: on/off state, appearance, frame sync, prefetch and recovery. */

import { BilingualSubtitleOverlay } from "./ui/bilingual-overlay";
import { PlayerTranslationToggle } from "./ui/player-translation-toggle";
import type { Panel } from "./ui/panel";
import { findActiveCueIndex, isTranscriptInOutputLanguage } from "./transcript";
import { resolveBilingualEnabled } from "./bilingual-preference";
import type { SubtitleStyleSettings } from "../service/subtitle-style";
import type { AISetupStatus } from "../service/ai-setup";
import { t, type OutputLanguage } from "../utils/i18n";
import { getCurrentPlaybackTime } from "./page";
import type { CaptionSession } from "./caption-session";
import type { ContentScriptConfig, Extractor } from "./content-types";

const VIDEO_SYNC_EVENTS = ["timeupdate", "seeking", "seeked", "loadedmetadata", "play", "ratechange"];

export interface BilingualHost {
  extractor: Extractor;
  config: ContentScriptConfig;
  getPanel(): Panel;
  getOutputLanguage(): OutputLanguage;
  getAISetupStatus(): AISetupStatus;
}

export interface BilingualSettings {
  defaultEnabled: boolean;
  learningMode: boolean;
  translationOnly: boolean;
  style: SubtitleStyleSettings;
}

export class BilingualController {
  /** The translate button next to the player's CC button. */
  readonly toggle: PlayerTranslationToggle;
  private readonly stateByVideo = new Map<string, boolean>();
  private defaultEnabled: boolean;
  private enabled: boolean;
  private learningMode: boolean;
  private translationOnly: boolean;
  private style: SubtitleStyleSettings;
  private overlay: BilingualSubtitleOverlay | null = null;
  private video: HTMLVideoElement | null = null;
  private syncHandler: (() => void) | null = null;
  private frameCallbackId: number | null = null;
  private frameCueId: string | number = -2;
  /** Armed after a failed overlay load; the next usable player captions retry it once. */
  private recovery: { videoId: string; overlay: BilingualSubtitleOverlay; player: HTMLElement } | null = null;

  constructor(
    private readonly session: CaptionSession,
    private readonly host: BilingualHost,
    settings: BilingualSettings,
  ) {
    this.defaultEnabled = settings.defaultEnabled;
    this.enabled = settings.defaultEnabled;
    this.learningMode = settings.learningMode;
    this.translationOnly = settings.translationOnly;
    this.style = settings.style;
    this.toggle = new PlayerTranslationToggle((enabled) => {
      this.setEnabled(enabled);
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean, rememberForVideo: boolean = true): void {
    const { extractor } = this.host;
    const videoId = extractor.getVideoId();
    if (rememberForVideo && videoId) this.stateByVideo.set(videoId, enabled);
    this.enabled = enabled;
    this.toggle.setEnabled(enabled);
    this.session.clearAutoErrors();
    if (enabled && this.host.getAISetupStatus().hasKey && extractor.isOnVideoPage()) {
      void this.activate();
      return;
    }
    this.session.dropOverlayJobs();
    this.destroy();
  }

  restoreForCurrentVideo(): void {
    const videoId = this.host.extractor.getVideoId();
    this.enabled = resolveBilingualEnabled(
      this.defaultEnabled,
      videoId ? this.stateByVideo.get(videoId) : undefined,
    );
    this.toggle.setEnabled(this.enabled);
  }

  setDefaultEnabled(value: boolean): void {
    if (value === this.defaultEnabled) return;
    this.defaultEnabled = value;
    const videoId = this.host.extractor.getVideoId();
    if (!videoId || !this.stateByVideo.has(videoId)) {
      this.setEnabled(this.defaultEnabled, false);
    }
  }

  setLearningMode(value: boolean): void {
    if (value === this.learningMode) return;
    this.learningMode = value;
    this.overlay?.setLearningMode(value);
  }

  setTranslationOnly(value: boolean): void {
    if (value === this.translationOnly) return;
    this.translationOnly = value;
    this.overlay?.setTranslationOnly(value);
  }

  setStyle(style: SubtitleStyleSettings): void {
    this.style = style;
    this.overlay?.setStyle(style);
  }

  setSourceReady(ready: boolean): void {
    this.overlay?.setSourceReady(ready);
  }

  clearRecovery(): void {
    this.recovery = null;
  }

  destroy(): void {
    if (this.video && this.syncHandler) {
      for (const event of VIDEO_SYNC_EVENTS) {
        this.video.removeEventListener(event, this.syncHandler);
      }
    }
    if (this.video && this.frameCallbackId !== null) {
      this.video.cancelVideoFrameCallback(this.frameCallbackId);
    }
    this.frameCallbackId = null;
    this.frameCueId = -2;
    this.video = null;
    this.syncHandler = null;
    this.overlay?.destroy();
    this.overlay = null;
  }

  /**
   * Without this, a failed automatic load stayed failed even after the player
   * fetched captions itself (e.g. the user turned CC on): a second click on the
   * extension was always required. The retry hits the MAIN-world cache.
   */
  onCaptionsAvailable(videoId: string): void {
    const recovery = this.recovery;
    if (!recovery || videoId !== recovery.videoId || videoId !== this.host.extractor.getVideoId()) return;
    this.recovery = null;
    if (this.overlay !== recovery.overlay || this.session.transcript || !this.enabled) return;
    void this.activate(recovery.player);
  }

  sync(playbackTime: number = getCurrentPlaybackTime()): void {
    const transcript = this.session.transcript;
    if (!this.overlay || !transcript || !this.enabled) return;
    const chunk = this.session.chunks[this.session.findChunkAtTime(playbackTime)];
    const aligned = chunk ? this.session.translations[chunk.id] : undefined;
    const translatedIndex = aligned ? findActiveCueIndex(aligned, playbackTime) : -1;
    const translated = translatedIndex >= 0 ? aligned![translatedIndex] : undefined;
    const rawIndex = findActiveCueIndex(transcript.segments, playbackTime);
    const raw = rawIndex >= 0 ? transcript.segments[rawIndex] : undefined;
    // A committed section's gaps stay gaps; don't show a raw rolling cue over them.
    const sourceText = aligned ? translated?.sourceText : raw?.text;
    if (!sourceText) {
      this.overlay.setCue(null);
      this.session.queueOverlayPrefetch(this.video?.playbackRate ?? 1);
      return;
    }
    const translationNeeded = !isTranscriptInOutputLanguage(transcript.languageCode, this.host.getOutputLanguage());
    const errorText = translationNeeded && !translated ? this.session.overlayErrorFor(chunk?.id ?? -1) : "";
    this.overlay.setCue({
      sourceText,
      translationText: translationNeeded ? translated?.text : undefined,
      statusText: translationNeeded && !translated ? (errorText || t("bilingualTranslating")) : undefined,
      retryText: errorText ? t("bilingualRetry") : undefined,
    });
    if (translationNeeded) this.session.queueOverlayPrefetch(this.video?.playbackRate ?? 1);
  }

  async activate(preferredPlayer?: HTMLElement): Promise<void> {
    const { extractor } = this.host;
    if (!this.enabled || !this.host.getAISetupStatus().hasKey || !extractor.isOnVideoPage()) return;
    const player = preferredPlayer?.matches("#movie_player, #player-container, #player")
      ? preferredPlayer
      : this.host.config.findInjectTarget();
    if (!player) return;
    this.destroy();
    const overlay = new BilingualSubtitleOverlay(player, () => {
      if (this.overlay !== overlay) return;
      if (this.session.transcript) this.retry();
      else void this.activate(player);
    });
    this.overlay = overlay;
    overlay.setLearningMode(this.learningMode);
    overlay.setTranslationOnly(this.translationOnly);
    overlay.setStyle(this.style);
    this.toggle.mount(player);
    this.toggle.setEnabled(this.enabled);
    overlay.setCue({ sourceText: t("fetchingTranscript") });
    const stateVersion = this.session.version;
    const isCurrent = () => this.enabled && this.overlay === overlay && stateVersion === this.session.version;
    try {
      const transcript = await this.session.ensureTranscript(this.host.getPanel(), stateVersion);
      if (!isCurrent()) return;
      this.session.ensureChunks(transcript);
      if (!isTranscriptInOutputLanguage(transcript.languageCode, this.host.getOutputLanguage())) {
        await this.session.ensureTranslationCache(stateVersion);
      }
      if (!isCurrent()) return;
      overlay.setSourceReady(true);
      const video = player.querySelector("video") ?? document.querySelector("video");
      if (video) this.bindVideo(video, overlay);
      this.sync();
    } catch (error) {
      if ((error as Error)?.name === "AbortError" || this.overlay !== overlay) return;
      overlay.setSourceReady(false);
      overlay.setCue({
        sourceText: error instanceof Error ? error.message : t("translationFailed"),
        retryText: t("bilingualRetry"),
      });
      // Only caption failures can be fixed by captions appearing later.
      if (!this.session.transcript) {
        this.recovery = { videoId: extractor.getVideoId(), overlay, player };
      }
    }
  }

  private bindVideo(video: HTMLVideoElement, overlay: BilingualSubtitleOverlay): void {
    this.video = video;
    this.syncHandler = () => this.sync();
    for (const event of VIDEO_SYNC_EVENTS) {
      video.addEventListener(event, this.syncHandler, { passive: true });
    }
    if (typeof video.requestVideoFrameCallback !== "function") return;
    const syncVideoFrame: VideoFrameRequestCallback = (_now, metadata) => {
      if (this.video !== video || this.overlay !== overlay || !this.enabled) return;
      const frameChunk = this.session.chunks[this.session.findChunkAtTime(metadata.mediaTime)];
      const frameTranslation = frameChunk ? this.session.translations[frameChunk.id] : undefined;
      const frameSegments = frameTranslation ?? this.session.transcript?.segments ?? [];
      const frameCueId = `${frameChunk?.id}:${findActiveCueIndex(frameSegments, metadata.mediaTime)}:${Boolean(frameTranslation)}`;
      if (frameCueId !== this.frameCueId) {
        this.frameCueId = frameCueId;
        this.sync(metadata.mediaTime);
      }
      this.frameCallbackId = video.requestVideoFrameCallback(syncVideoFrame);
    };
    this.frameCallbackId = video.requestVideoFrameCallback(syncVideoFrame);
  }

  private retry(): void {
    if (!this.overlay || !this.session.transcript || !this.enabled) return;
    const chunk = this.session.chunks[this.session.findChunkAtTime(getCurrentPlaybackTime())];
    if (!chunk) return;
    this.overlay.setSourceReady(true);
    this.session.retryOverlayChunk(chunk);
  }
}
