/**
 * Captions, translation chunks and translations of the current video, the
 * translation cache and the translation job queue. This is the only owner of
 * that state; the transcript reader and the player overlay read it through
 * getters and change it through the methods below.
 */

import type { Panel } from "./ui/panel";
import { isTranscriptInOutputLanguage, type Transcript } from "./transcript";
import { prepareCaptionSource, fingerprintCaptionSource } from "./caption-source";
import { getOverlayPrefetchChunk } from "./caption-prefetch";
import { getActiveAIIdentity } from "../service/ai-client";
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
import { getTranslationChunkLimits, type TranslationChunkPreset } from "../service/ai-controls";
import type { AISetupStatus } from "../service/ai-setup";
import { t, type OutputLanguage } from "../utils/i18n";
import { getCurrentPlaybackTime } from "./page";
import { localizedText, type Extractor, type LocalizedMessage } from "./content-types";

type TranslationJobKind = "overlay" | "section" | "all";

interface TranslationJob {
  kind: TranslationJobKind;
  targetStart: number;
  targetEnd: number;
  forceRefresh: boolean;
  sectionId?: number;
  customInstruction?: string;
}

export interface CaptionSessionHost {
  extractor: Extractor;
  getPanel(): Panel;
  currentPanel(): Panel | null;
  getOutputLanguage(): OutputLanguage;
  getCustomInstruction(): string;
  getPreferredCaptionLanguage(): string;
  getChunkPreset(): TranslationChunkPreset;
  getAISetupStatus(): AISetupStatus;
  /** Re-render everything that shows translations (reader, player overlay). */
  renderTranslationConsumers(): void;
  /** Player overlay source availability after a translation job. */
  setOverlaySourceReady(ready: boolean): void;
  /** Cache reset: drop every page-level state of the video before reloading. */
  clearForReload(): void;
  /** Cache reset: captions were reloaded; position consumers on the new source. */
  onSourceReloaded(panel: Panel, transcript: Transcript): void;
  /** Cache reset finished after a successful reload. */
  onReloadFinished(): void;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

export class CaptionSession {
  private transcriptData: Transcript | null = null;
  private transcriptVideoId = "";
  private transcriptFingerprint: Promise<string> | null = null;
  private cacheLoad: { key: string; version: number; revision: number; task: Promise<void> } | null = null;
  private transcriptChunks: TranslationChunk[] = [];
  private translatedSections: Record<number, TranslatedSegment[]> = {};
  private translationIdentityKey = "";
  private translationCacheRevision = 0;
  private translationCacheReset: { videoId: string; task: Promise<void> } | null = null;
  private stateVersion = 0;
  private translationTask: Promise<void> | null = null;
  private translationAbort: AbortController | null = null;
  private translationJobs: TranslationJob[] = [];
  private currentTranslationJob: TranslationJob | null = null;
  private fullTranslationRequested = false;
  private translationProgressMessage: LocalizedMessage | null = null;
  private autoTranslationErrors: Record<number, string> = {};
  private autoTranslationBlockedMessage = "";
  private recentCaptionTranslationMs: number[] = [];

  constructor(private readonly host: CaptionSessionHost) {}

  // ── Read access ────────────────────────────────────────────────────
  get transcript(): Transcript | null { return this.transcriptData; }
  get chunks(): readonly TranslationChunk[] { return this.transcriptChunks; }
  get translations(): Readonly<Record<number, TranslatedSegment[]>> { return this.translatedSections; }
  /** Bumped whenever source or translations are invalidated; stale async work compares against it. */
  get version(): number { return this.stateVersion; }
  get progressText(): string { return localizedText(this.translationProgressMessage); }
  get isTranslating(): boolean { return this.translationTask !== null; }

  /** Error to show for an untranslated chunk in the player overlay. */
  overlayErrorFor(chunkId: number): string {
    return this.autoTranslationErrors[chunkId] || this.autoTranslationBlockedMessage;
  }

  isCacheResetting(videoId: string): boolean {
    return this.translationCacheReset?.videoId === videoId;
  }

  isChunkTranslated(chunk: TranslationChunk): boolean {
    return Boolean(this.translatedSections[chunk.id]?.length);
  }

  needsTranslation(): boolean {
    return Boolean(this.transcriptData) &&
      !isTranscriptInOutputLanguage(this.transcriptData!.languageCode, this.host.getOutputLanguage());
  }

  findChunkAtTime(time: number): number {
    // Prefer the latest block start: YouTube event display durations often overlap.
    let low = 0;
    let high = this.transcriptChunks.length - 1;
    let result = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const first = this.transcriptData!.segments[this.transcriptChunks[middle].targetStart];
      if (first.start <= time) { result = middle; low = middle + 1; }
      else high = middle - 1;
    }
    return result;
  }

  // ── Source ─────────────────────────────────────────────────────────
  async ensureTranscript(
    panel: Panel,
    expectedVersion: number = this.stateVersion,
  ): Promise<Transcript> {
    const videoId = this.host.extractor.getVideoId();
    if (this.transcriptData && this.transcriptVideoId === videoId) return this.transcriptData;
    const transcript = prepareCaptionSource(
      await this.host.extractor.getTranscript(this.host.getPreferredCaptionLanguage()),
    );
    if (expectedVersion !== this.stateVersion) throw abortError();
    if (!transcript.segments.length) {
      throw new UserError(
        t("errorEmptyTranscript"),
        "EMPTY_TRANSCRIPT",
      );
    }
    this.transcriptData = transcript;
    this.transcriptVideoId = videoId;
    if (isTranscriptInOutputLanguage(transcript.languageCode, this.host.getOutputLanguage())) {
      panel.setTranslationAvailable(false);
    }
    return transcript;
  }

  ensureChunks(transcript: Transcript): void {
    if (!this.transcriptChunks.length) this.transcriptChunks = this.buildChunks(transcript);
  }

  private buildChunks(transcript: Transcript): TranslationChunk[] {
    const limits = getTranslationChunkLimits(this.host.getChunkPreset());
    return buildTranslationChunks(transcript.segments, limits.maxChars, limits.maxSeconds);
  }

  // ── Invalidation ───────────────────────────────────────────────────
  /** New video or caption source: forget everything. */
  clear(): void {
    this.stateVersion += 1;
    this.translationAbort?.abort();
    this.transcriptData = null;
    this.transcriptVideoId = "";
    this.transcriptFingerprint = null;
    this.cacheLoad = null;
    this.transcriptChunks = [];
    this.translatedSections = {};
    this.translationIdentityKey = "";
    this.translationTask = null;
    this.translationAbort = null;
    this.translationJobs = [];
    this.currentTranslationJob = null;
    this.fullTranslationRequested = false;
    this.autoTranslationErrors = {};
    this.autoTranslationBlockedMessage = "";
    this.recentCaptionTranslationMs = [];
    this.translationProgressMessage = null;
  }

  /** Chunk preset changed: same captions, new chunks, no translations. Returns whether captions are loaded. */
  invalidateForChunkPreset(): boolean {
    this.stateVersion += 1;
    this.translatedSections = {};
    this.translationIdentityKey = "";
    this.clearAutoErrors();
    this.translationAbort?.abort();
    this.translationJobs = [];
    this.fullTranslationRequested = false;
    this.translationProgressMessage = null;
    if (!this.transcriptData) return false;
    this.transcriptChunks = this.buildChunks(this.transcriptData);
    return true;
  }

  /** Provider or model changed: translations belong to the previous model. */
  invalidateForModelChange(): void {
    this.stateVersion += 1;
    this.translationAbort?.abort();
    this.translationJobs = [];
    this.translatedSections = {};
    this.translationIdentityKey = "";
    this.clearAutoErrors();
  }

  /** API key removed: stop all AI work. */
  stopForMissingKey(): void {
    this.translationAbort?.abort();
    this.translationJobs = [];
    this.clearAutoErrors();
  }

  clearAutoErrors(): void {
    this.autoTranslationErrors = {};
    this.autoTranslationBlockedMessage = "";
  }

  /** Player overlay turned off: its jobs are no longer needed. */
  dropOverlayJobs(): void {
    this.translationJobs = this.translationJobs.filter((job) => job.kind !== "overlay");
    if (this.currentTranslationJob?.kind === "overlay") this.translationAbort?.abort();
  }

  /** Panel closed: keep feeding the overlay, stop reader-requested work. */
  dropReaderJobs(): void {
    this.translationJobs = this.translationJobs.filter((job) => job.kind === "overlay");
    if (this.currentTranslationJob?.kind !== "overlay") this.translationAbort?.abort();
  }

  // ── Translation cache ──────────────────────────────────────────────
  async ensureTranslationCache(
    expectedVersion: number = this.stateVersion,
  ): Promise<TranslationCacheIdentity> {
    if (this.translationCacheReset?.videoId === this.host.extractor.getVideoId()) {
      await this.translationCacheReset.task;
    }
    const cacheRevision = this.translationCacheRevision;
    const assertCurrent = () => {
      if (expectedVersion !== this.stateVersion || cacheRevision !== this.translationCacheRevision) {
        throw abortError();
      }
    };
    assertCurrent();
    const transcript = this.transcriptData!;
    const ai = await getActiveAIIdentity();
    assertCurrent();
    const fingerprint = this.transcriptFingerprint ??= fingerprintCaptionSource(transcript);
    const identity: TranslationCacheIdentity = {
      videoId: this.host.extractor.getVideoId(),
      sourceLanguage: transcript.languageCode,
      providerId: ai.providerId,
      modelId: ai.modelId,
      targetLanguage: this.host.getOutputLanguage(),
      sourceFingerprint: `${await fingerprint}:${this.host.getChunkPreset()}`,
    };
    assertCurrent();
    // Custom instructions intentionally do not participate in cache identity.
    // Users opt into new wording through the explicit retranslation actions.
    const key = JSON.stringify(identity);
    if (this.translationIdentityKey !== key) {
      if (
        this.cacheLoad?.key === key && this.cacheLoad.version === expectedVersion &&
        this.cacheLoad.revision === cacheRevision
      ) {
        await this.cacheLoad.task;
        assertCurrent();
        return identity;
      }
      this.translatedSections = {};
      const task = (async () => {
        const cached = await getCachedTranslation(identity);
        assertCurrent();
        for (const section of Object.values(cached?.sections ?? {})) {
          const chunk = this.transcriptChunks[section.chunkId];
          if (!chunk || chunk.targetStart !== section.targetStart || chunk.targetEnd !== section.targetEnd) continue;
          try {
            const aligned = alignTranslatedParts(transcript, chunk, section.segments.map((segment) => ({
              source: segment.sourceText, translation: segment.text,
            })));
            // Reconstruct observed times rather than trusting persistent timestamps.
            this.translatedSections[chunk.id] = aligned;
          } catch {
            // Invalid coverage or timing invalidates the whole section.
          }
        }
        this.translationIdentityKey = key;
      })();
      this.cacheLoad = { key, version: expectedVersion, revision: cacheRevision, task };
      try { await task; }
      finally { if (this.cacheLoad?.task === task) this.cacheLoad = null; }
    }
    return identity;
  }

  private async persistTranslationSectionSafely(
    identity: TranslationCacheIdentity, chunk: TranslationChunk, segments: TranslatedSegment[],
  ): Promise<void> {
    try {
      await setCachedTranslationSection(identity, {
        chunkId: chunk.id, targetStart: chunk.targetStart, targetEnd: chunk.targetEnd, segments,
      });
    } catch (error) {
      console.debug("[vas] Translation cache write failed:", error);
      const panel = this.host.currentPanel();
      if (panel?.getMode() === "transcript") panel.showWarning(t("translationCacheWriteFailed"));
    }
  }

  /** Toolbar action: delete this video's translations and source captions, then reload them. */
  resetVideoCache(): void {
    const { extractor } = this.host;
    const videoId = extractor.getVideoId();
    if (!videoId || !this.transcriptData || this.translationCacheReset) return;
    let stateVersion = this.stateVersion;
    const pendingWorker = this.translationTask;
    const reset = { videoId, task: Promise.resolve() };
    // Block prefetch before aborting: worker cleanup also renders the overlay.
    this.translationCacheReset = reset;
    this.translationCacheRevision += 1;
    this.translationJobs = [];
    this.fullTranslationRequested = false;
    this.translationAbort?.abort();
    this.host.currentPanel()?.setTranslationCacheClearing(true);
    this.translationProgressMessage = { key: "clearingTranslationCache" };
    this.host.currentPanel()?.setTranslationProgress(this.progressText);
    const isCurrent = () => stateVersion === this.stateVersion &&
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
        this.host.clearForReload();
        stateVersion = this.stateVersion;
        cacheCleared = true;
        const panel = this.host.currentPanel()!;
        panel.reset();
        panel.setMode("loading");
        panel.setLoadingMessage("fetchingTranscript");
        const transcript = await this.ensureTranscript(panel, stateVersion);
        if (!isCurrent()) return;
        this.transcriptChunks = this.buildChunks(transcript);
        this.host.onSourceReloaded(panel, transcript);
        this.translatedSections = {};
        this.translationIdentityKey = "";
        this.clearAutoErrors();
        this.translationProgressMessage = { key: "translationCacheCleared" };
      } catch (error) {
        console.debug("[vas] Translation cache reset failed:", error);
        if (isCurrent()) {
          this.translationProgressMessage = {
            key: cacheCleared ? "translationCacheCleared" : "translationCacheClearFailed",
          };
          const panel = this.host.currentPanel();
          if (cacheCleared) {
            panel?.reset();
            panel?.showError(error instanceof Error ? error.message : t("errorYoutubeCaptionUnavailable"));
          } else panel?.showWarning(t("translationCacheClearFailed"));
        }
      } finally {
        if (this.translationCacheReset === reset) this.translationCacheReset = null;
        if (isCurrent()) {
          this.host.currentPanel()?.setTranslationCacheClearing(false);
          this.host.currentPanel()?.setTranslationProgress(this.progressText);
          // Enabled bilingual captions request fresh translations at playback;
          // the reader offers Translate section / Translate all again.
          this.host.renderTranslationConsumers();
          if (cacheCleared && this.transcriptData) this.host.onReloadFinished();
        }
      }
    })();
  }

  // ── Translation queue ──────────────────────────────────────────────
  private async processTranslationJob(
    job: TranslationJob,
    controller: AbortController,
    stateVersion: number,
  ): Promise<void> {
    const transcript = this.transcriptData!;
    const identity = await this.ensureTranslationCache(stateVersion);
    const assertCurrent = () => {
      if (controller.signal.aborted || stateVersion !== this.stateVersion) throw abortError();
    };
    assertCurrent();

    const chunks = this.transcriptChunks.filter((chunk) =>
      chunk.targetEnd >= job.targetStart && chunk.targetStart <= job.targetEnd);
    for (const chunk of chunks) {
      assertCurrent();
      if (!job.forceRefresh && this.isChunkTranslated(chunk)) continue;
      if (job.forceRefresh) {
        await invalidateTranslationSection(identity, chunk.id);
        assertCurrent();
      }
      const requestStart = performance.now();
      const result = await translateTranscriptChunk(
        transcript, chunk, identity.targetLanguage,
        (_partial, formatRetry) => {
          if (controller.signal.aborted || stateVersion !== this.stateVersion) return;
          if (formatRetry && job.sectionId !== undefined) {
            this.translationProgressMessage = {
              key: "repairingSectionFormat", substitutions: String(chunk.id + 1),
            };
            this.host.currentPanel()?.setTranslationProgress(this.progressText);
          }
        }, controller.signal, job.customInstruction ?? "", {
          videoId: identity.videoId, providerId: identity.providerId, modelId: identity.modelId,
        },
      );
      assertCurrent();
      this.recentCaptionTranslationMs = [
        ...this.recentCaptionTranslationMs, performance.now() - requestStart,
      ].slice(-3);
      // Whole-block commit: partial / retried output never changes playback or disk.
      this.translatedSections[chunk.id] = result;
      delete this.autoTranslationErrors[chunk.id];
      this.host.renderTranslationConsumers();
      await this.persistTranslationSectionSafely(identity, chunk, result);
      assertCurrent();
    }
    if (job.kind !== "overlay") this.autoTranslationBlockedMessage = "";
  }

  private enqueueTranslationJob(job: TranslationJob): void {
    if (this.isCacheResetting(this.host.extractor.getVideoId())) return;
    if (!this.transcriptData || job.targetStart > job.targetEnd) return;
    job.customInstruction ??= this.host.getCustomInstruction();
    const current = this.currentTranslationJob;
    const alreadyCurrent = !this.translationAbort?.signal.aborted && current &&
      current.kind === job.kind &&
      current.targetStart <= job.targetStart &&
      current.targetEnd >= job.targetEnd;
    const alreadyQueued = this.translationJobs.some((queued) =>
      queued.kind === job.kind &&
      queued.targetStart <= job.targetStart &&
      queued.targetEnd >= job.targetEnd,
    );
    if (alreadyCurrent || alreadyQueued) return;

    if (job.kind === "overlay") {
      this.translationJobs = this.translationJobs.filter((queued) => queued.kind !== "overlay");
      const playbackChunk = this.transcriptChunks[this.findChunkAtTime(getCurrentPlaybackTime())];
      const servesPlayback = playbackChunk && job.targetStart <= playbackChunk.targetEnd &&
        job.targetEnd >= playbackChunk.targetStart;
      if (
        current?.kind === "overlay" &&
        servesPlayback &&
        (job.targetStart > current.targetEnd ||
          job.targetEnd < current.targetStart)
      ) {
        this.translationAbort?.abort();
      }
      this.translationJobs.unshift(job);
    } else if (job.kind === "section") {
      const firstNonOverlay = this.translationJobs.findIndex((queued) => queued.kind !== "overlay");
      this.translationJobs.splice(firstNonOverlay < 0 ? this.translationJobs.length : firstNonOverlay, 0, job);
    } else {
      this.translationJobs.push(job);
    }
    this.startTranslationWorker();
  }

  private startTranslationWorker(): void {
    if (this.isCacheResetting(this.host.extractor.getVideoId())) return;
    if (this.translationTask || !this.transcriptData) return;
    const stateVersion = this.stateVersion;
    const panel = this.host.getPanel();
    panel.setTranslationActionsBusy(true);
    const task = (async () => {
      while (this.translationJobs.length && stateVersion === this.stateVersion) {
        const job = this.translationJobs.shift()!;
        this.currentTranslationJob = job;
        const controller = new AbortController();
        this.translationAbort = controller;
        if (job.kind === "all") {
          const completed = job.forceRefresh
            ? (job.sectionId ?? 0)
            : this.transcriptChunks.filter((chunk) => this.isChunkTranslated(chunk)).length;
          this.translationProgressMessage = {
            key: "translatingAllProgress",
            substitutions: [String(completed), String(this.transcriptChunks.length)],
          };
        } else if (job.kind === "section" && job.sectionId !== undefined) {
          this.translationProgressMessage = {
            key: "translatingSectionProgress",
            substitutions: [String(job.sectionId + 1), String(this.transcriptChunks.length)],
          };
        }
        panel.setTranslationProgress(this.progressText);

        try {
          await this.processTranslationJob(job, controller, stateVersion);
          this.host.setOverlaySourceReady(true);
          if (job.kind === "section") {
            this.translationProgressMessage = { key: "translationSectionDone" };
          }
        } catch (error) {
          if (
            (error as Error)?.name !== "AbortError" && !controller.signal.aborted &&
            stateVersion === this.stateVersion
          ) {
            const message = error instanceof Error ? error.message : t("translationFailed");
            if (job.kind === "overlay") {
              this.autoTranslationBlockedMessage = message;
              for (const chunk of this.transcriptChunks) {
                if (
                  chunk.targetEnd >= job.targetStart && chunk.targetStart <= job.targetEnd &&
                  !this.isChunkTranslated(chunk)
                ) {
                  this.autoTranslationErrors[chunk.id] = message;
                }
              }
              if ((error as Error)?.name === "NoApiKeyError") {
                this.host.setOverlaySourceReady(false);
              }
            } else {
              this.translationProgressMessage = {
                key: "translationStopped",
                substitutions: message,
              };
              this.translationJobs = this.translationJobs.filter((queued) => queued.kind === "overlay");
              this.fullTranslationRequested = false;
              if (panel.getMode() === "transcript") panel.showWarning(message);
            }
            const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
            console.debug("[vas] Translation stopped:", detail);
          }
        } finally {
          if (this.translationAbort === controller) {
            this.currentTranslationJob = null;
            this.translationAbort = null;
            this.host.renderTranslationConsumers();
          }
        }
      }
      if (stateVersion === this.stateVersion) {
        if (
          this.fullTranslationRequested &&
          this.transcriptChunks.every((chunk) => this.isChunkTranslated(chunk))
        ) {
          this.translationProgressMessage = { key: "translationAllDone" };
        }
        this.fullTranslationRequested = false;
      }
    })().finally(() => {
      if (this.translationTask !== task) return;
      this.translationTask = null;
      this.translationAbort = null;
      this.currentTranslationJob = null;
      panel.setTranslationActionsBusy(false);
      panel.setTranslationProgress(this.progressText);
      this.host.renderTranslationConsumers();
      if (this.translationJobs.length) this.startTranslationWorker();
    });
    this.translationTask = task;
  }

  /**
   * Reader actions "Translate section" / "Translate all". `onAccepted` runs
   * once the request passed the availability checks (the reader switches to
   * the translation view there for a single section).
   */
  requestTranslation(
    panel: Panel,
    requestedChunkIds: number[],
    forceRefresh: boolean,
    isFullTranslation: boolean,
    onAccepted: () => void,
  ): void {
    if (this.isCacheResetting(this.host.extractor.getVideoId())) return;
    const aiSetupStatus = this.host.getAISetupStatus();
    if (!aiSetupStatus.hasKey) {
      panel.setAIAvailable(false, aiSetupStatus.providerName);
      return;
    }
    if (!this.transcriptData) return;
    onAccepted();
    const chunks = requestedChunkIds
      .map((chunkId) => this.transcriptChunks[chunkId])
      .filter(Boolean);
    const pending = chunks.filter((chunk) => forceRefresh || !this.isChunkTranslated(chunk));
    if (!pending.length) {
      this.translationProgressMessage = {
        key: isFullTranslation ? "translationAllAlreadyDone" : "translationSectionAlreadyDone",
      };
      panel.setTranslationProgress(this.progressText);
      return;
    }
    if (isFullTranslation) this.fullTranslationRequested = true;
    for (const chunk of pending) {
      this.enqueueTranslationJob({
        kind: isFullTranslation ? "all" : "section",
        targetStart: chunk.targetStart,
        targetEnd: chunk.targetEnd,
        forceRefresh,
        sectionId: chunk.id,
      });
    }
  }

  /** Player overlay: translate the chunk that is about to be needed. */
  queueOverlayPrefetch(playbackRate: number): void {
    const transcript = this.transcriptData;
    if (
      this.isCacheResetting(this.host.extractor.getVideoId()) || !transcript ||
      this.fullTranslationRequested || this.autoTranslationBlockedMessage ||
      isTranscriptInOutputLanguage(transcript.languageCode, this.host.getOutputLanguage())
    ) return;
    const time = getCurrentPlaybackTime();
    const current = this.findChunkAtTime(time);
    const chunk = getOverlayPrefetchChunk(
      transcript.segments, this.transcriptChunks, current, time,
      (candidate) => this.isChunkTranslated(candidate), playbackRate, this.recentCaptionTranslationMs,
    );
    if (!chunk || this.autoTranslationErrors[chunk.id]) return;
    this.enqueueTranslationJob({
      kind: "overlay", targetStart: chunk.targetStart, targetEnd: chunk.targetEnd,
      sectionId: chunk.id, forceRefresh: false,
    });
  }

  /** Player overlay retry button: retranslate the chunk at the playback position. */
  retryOverlayChunk(chunk: TranslationChunk): void {
    this.autoTranslationBlockedMessage = "";
    delete this.autoTranslationErrors[chunk.id];
    this.enqueueTranslationJob({
      kind: "overlay", targetStart: chunk.targetStart, targetEnd: chunk.targetEnd,
      sectionId: chunk.id, forceRefresh: true,
    });
  }
}
