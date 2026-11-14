/** AI summary and summary translation for the current video. */

import type { Panel } from "./ui/panel";
import { renderMarkdown, renderStreaming } from "./ui/renderer";
import {
  summarizeTextStream,
  getActiveAIIdentity,
  translateSummaryStream,
} from "../service/ai-client";
import { transcriptToText, type Transcript } from "./transcript";
import {
  getCachedSummary,
  setCachedSummary,
  invalidateCache,
} from "../service/summary-cache";
import { handleError } from "./error-handler";
import { runSummaryCacheOperation } from "./summary-cache-operation";
import { getOutputLanguageInfo, t, type OutputLanguage } from "../utils/i18n";
import { analyzeTextScripts, logI18nDebug } from "../utils/i18n-debug";
import {
  detectOutputLanguage,
  type OutputLanguageStatus,
} from "../utils/output-language-detection";
import type { AISetupStatus } from "../service/ai-setup";
import type { Extractor } from "./content-types";

const SUMMARY_SOURCE = "youtube";

interface DisplayedSummary {
  text: string;
  videoId: string;
  videoTitle: string;
  outputLanguage: OutputLanguage;
  languageStatus: OutputLanguageStatus;
}

/** What the summary flow needs from the rest of the content script. */
export interface SummaryHost {
  extractor: Extractor;
  getPanel(): Panel;
  ensureTranscript(panel: Panel): Promise<Transcript>;
  getOutputLanguage(): OutputLanguage;
  getCustomInstruction(): string;
  getAISetupStatus(): AISetupStatus;
  /** Called after a summary request ends and none is running anymore. */
  onIdle(): void;
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

export class SummaryController {
  private displayed: DisplayedSummary | null = null;
  private summaryAbort: AbortController | null = null;
  private translationAbort: AbortController | null = null;

  constructor(private readonly host: SummaryHost) {}

  isRunning(): boolean {
    return this.summaryAbort !== null;
  }

  /** Stop running requests; the displayed summary stays. */
  abort(): void {
    this.summaryAbort?.abort();
    this.translationAbort?.abort();
  }

  abortTranslation(): void {
    this.translationAbort?.abort();
    this.translationAbort = null;
  }

  /** New video or output language: drop everything. */
  reset(): void {
    this.summaryAbort?.abort();
    this.translationAbort?.abort();
    this.summaryAbort = null;
    this.translationAbort = null;
    this.displayed = null;
  }

  refreshLocalizedText(panel: Panel): void {
    if (this.displayed) this.showTranslationAction(panel, this.displayed);
  }

  private showTranslationAction(panel: Panel, summary: DisplayedSummary): void {
    panel.showSummaryTranslationAction(
      getOutputLanguageInfo(summary.outputLanguage).nativeName,
    );
    panel.setSummaryTranslationAttention(summary.languageStatus === "mismatch");
  }

  private async detectLanguage(
    panel: Panel,
    summary: DisplayedSummary,
    requestId: string,
    source: "generated" | "cache" | "translation",
  ): Promise<void> {
    const detection = await detectOutputLanguage(summary.text, summary.outputLanguage);
    if (this.displayed !== summary || this.host.getOutputLanguage() !== summary.outputLanguage) return;

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

  async summarize(): Promise<void> {
    const panel = this.host.getPanel();

    // 字幕视图会复用内容容器，但总结仍保存在内存中。此时“AI 总结”
    // 是返回总结视图的入口；只有已处于总结视图时，点击才会强制刷新。
    if (
      panel.getMode() !== "summary" &&
      this.displayed?.text.trim() &&
      this.displayed.videoId === this.host.extractor.getVideoId() &&
      this.displayed.outputLanguage === this.host.getOutputLanguage()
    ) {
      panel.setTitle(this.displayed.videoTitle || this.host.extractor.getVideoTitle());
      panel.setContent(renderMarkdown(this.displayed.text));
      this.showTranslationAction(panel, this.displayed);
      panel.setMode("summary");
      panel.setCachedView(true);
      panel.open();
      return;
    }

    if (!this.host.getAISetupStatus().hasKey) {
      panel.setAIAvailable(false, this.host.getAISetupStatus().providerName);
      return;
    }
    const requestedLanguage = this.host.getOutputLanguage();
    const customInstruction = this.host.getCustomInstruction();
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.translationAbort?.abort();
    this.translationAbort = null;
    this.displayed = null;
    panel.hideSummaryTranslationAction();
    this.summaryAbort?.abort();
    const summaryController = new AbortController();
    this.summaryAbort = summaryController;
    let renderFrameId: number | null = null;
    const assertCurrent = () => {
      if (
        summaryController.signal.aborted ||
        this.summaryAbort !== summaryController ||
        requestedLanguage !== this.host.getOutputLanguage()
      ) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
    };
    let cacheFailed = false;
    const reportCacheFailure = () => {
      cacheFailed = true;
    };

    try {
      const videoId = this.host.extractor.getVideoId();
      const videoTitle = this.host.extractor.getVideoTitle();

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
          this.displayed = summaryState;
          // 缓存命中——直接显示
          panel.setTitle(videoTitle || cached.videoTitle);
          panel.setContent(renderMarkdown(cached.text));
          this.showTranslationAction(panel, summaryState);
          panel.setMode("summary");
          panel.setCachedView(true);

          // 显示缓存时间
          const elapsed = Date.now() - cached.timestamp;
          const hint = formatCacheAge(elapsed);
          panel.showCacheHint(t("cachedAt", hint));
          panel.open();
          await this.detectLanguage(panel, summaryState, requestId, "cache");
          assertCurrent();
          return;
        }
      }

      // ── 缓存未命中或强制刷新——走 API ──
      panel.setMode("loading");
      panel.setLoadingMessage("fetchingTranscript");
      panel.setCachedView(false);
      panel.open();

      const transcript = await this.host.ensureTranscript(panel);
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
            if (!summaryController.signal.aborted && this.summaryAbort === summaryController) {
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
      this.displayed = summaryState;
      if (summaryState) this.showTranslationAction(panel, summaryState);
      panel.setMode("summary");
      // API 获取的新内容，标记为可「再次总结」
      panel.setCachedView(true);
      if (cacheFailed) {
        panel.showWarning(t("summaryCacheUnavailable"));
      }
      if (summaryState) {
        await this.detectLanguage(panel, summaryState, requestId, "generated");
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
      if (this.summaryAbort === summaryController) this.summaryAbort = null;
      if (!this.summaryAbort) this.host.onIdle();
    }
  }

  async translate(): Promise<void> {
    const sourceSummary = this.displayed;
    if (!sourceSummary?.text.trim() || this.translationAbort) return;

    const panel = this.host.getPanel();
    if (!this.host.getAISetupStatus().hasKey) {
      panel.setAIAvailable(false, this.host.getAISetupStatus().providerName);
      return;
    }
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    const customInstruction = this.host.getCustomInstruction();
    this.translationAbort = controller;
    let renderFrameId: number | null = null;
    let pendingRender = false;
    let streamStarted = false;
    let translatedText = "";
    let cacheFailed = false;

    const assertSourceCurrent = () => {
      if (
        controller.signal.aborted ||
        this.translationAbort !== controller ||
        this.displayed !== sourceSummary ||
        this.host.getOutputLanguage() !== sourceSummary.outputLanguage ||
        this.host.extractor.getVideoId() !== sourceSummary.videoId
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
            if (!controller.signal.aborted && this.displayed === sourceSummary) {
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
      this.displayed = translatedSummary;
      this.showTranslationAction(panel, translatedSummary);
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
        this.translationAbort !== controller ||
        this.displayed !== translatedSummary
      ) {
        throw new DOMException("The operation was aborted", "AbortError");
      }

      await this.detectLanguage(
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

      if (this.displayed === sourceSummary) {
        panel.setContent(renderMarkdown(sourceSummary.text));
        panel.setMode("summary");
        this.showTranslationAction(panel, sourceSummary);
        panel.showWarning(t("summaryTranslationFailed"));
      }
      logI18nDebug("summary manual translation failed", {
        requestId,
        requestedLanguage: sourceSummary.outputLanguage,
        errorName: (error as Error)?.name ?? "unknown",
      });
    } finally {
      if (renderFrameId !== null) cancelAnimationFrame(renderFrameId);
      if (this.translationAbort === controller) this.translationAbort = null;
      panel.setSummaryTranslationBusy(false);
    }
  }
}
