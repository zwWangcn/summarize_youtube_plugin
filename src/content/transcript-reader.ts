/** Side-panel caption reader: lazy-loaded sections, scroll position and source/translation view. */

import type { Panel, TranscriptView } from "./ui/panel";
import { renderTranscriptSections } from "./ui/renderer";
import { isTranscriptInOutputLanguage } from "./transcript";
import { handleError } from "./error-handler";
import { formatTime } from "../utils/text";
import { t, type OutputLanguage } from "../utils/i18n";
import {
  getTranscriptLazyLoadDirection,
  getTranscriptTargetScrollTop,
} from "./transcript-scroll";
import { getCurrentPlaybackTime } from "./page";
import type { CaptionSession } from "./caption-session";
import type { Extractor } from "./content-types";

export interface TranscriptReaderHost {
  extractor: Extractor;
  getPanel(): Panel;
  currentPanel(): Panel | null;
  getOutputLanguage(): OutputLanguage;
  /** Opening the reader leaves the summary view. */
  onShow(): void;
}

export class TranscriptReader {
  private activeChunkId = 0;
  private loadedChunkStart = 0;
  private loadedChunkEnd = 0;
  private withTimestamps = true;
  private scrollTop = 0;
  private view: TranscriptView = "source";

  constructor(
    private readonly session: CaptionSession,
    private readonly host: TranscriptReaderHost,
  ) {}

  /** Wire lazy loading to a freshly mounted panel. */
  attach(panel: Panel): void {
    panel.getContentElement().addEventListener(
      "scroll",
      () => this.handleScroll(panel),
      { passive: true },
    );
    panel.getContentElement().addEventListener(
      "wheel",
      (event) => this.handleWheel(panel, event),
      { passive: false },
    );
  }

  /** New caption source: back to the source view at the top. */
  reset(): void {
    this.view = "source";
    this.scrollTop = 0;
  }

  /** Center the loaded window on the section at the playback position. */
  syncToPlayback(): void {
    const chunkCount = this.session.chunks.length;
    this.activeChunkId = this.session.findChunkAtTime(getCurrentPlaybackTime());
    this.loadedChunkStart = Math.max(0, this.activeChunkId - 1);
    this.loadedChunkEnd = Math.min(chunkCount - 1, this.activeChunkId + 1);
  }

  /** Re-render if the reader is what the panel currently shows. */
  renderIfVisible(preserveScroll: boolean = true): void {
    const panel = this.host.currentPanel();
    if (panel?.getMode() === "transcript") this.render(panel, preserveScroll);
  }

  render(panel: Panel, preserveScroll: boolean = true): void {
    const transcript = this.session.transcript;
    const chunks = this.session.chunks;
    if (!transcript || !chunks.length) return;
    const content = panel.getContentElement();
    const previousTop = preserveScroll ? this.scrollTop : content.scrollTop;
    const anchor = preserveScroll
      ? content.querySelector<HTMLElement>(`[data-chunk-id="${this.activeChunkId}"]`)
      : null;
    const anchorTop = anchor?.getBoundingClientRect().top;
    renderTranscriptSections(content, transcript, {
      chunks: [...chunks],
      loadedStart: this.loadedChunkStart,
      loadedEnd: this.loadedChunkEnd,
      activeChunkId: this.activeChunkId,
      view: this.view,
      translations: this.session.translations,
      withTimestamps: this.withTimestamps,
    });
    if (preserveScroll) {
      const nextAnchor = content.querySelector<HTMLElement>(`[data-chunk-id="${this.activeChunkId}"]`);
      const delta = anchorTop !== undefined && nextAnchor
        ? nextAnchor.getBoundingClientRect().top - anchorTop
        : 0;
      content.scrollTop = previousTop + delta;
      this.scrollTop = content.scrollTop;
    }
    this.updateToolbar(panel);
  }

  /** "Raw captions" button. */
  async show(withTimestamps: boolean): Promise<void> {
    const panel = this.host.getPanel();
    const shouldSyncToPlayback = panel.getMode() !== "transcript";
    this.host.onShow();
    const stateVersion = this.session.version;
    panel.setMode("loading");
    panel.setLoadingMessage("fetchingTranscript");
    panel.open();

    try {
      const transcript = await this.session.ensureTranscript(panel, stateVersion);
      panel.setTitle(this.host.extractor.getVideoTitle());
      this.withTimestamps = withTimestamps;
      this.session.ensureChunks(transcript);
      if (shouldSyncToPlayback) this.syncToPlayback();
      const outputLanguage = this.host.getOutputLanguage();
      if (!isTranscriptInOutputLanguage(transcript.languageCode, outputLanguage)) {
        await this.session.ensureTranslationCache(stateVersion);
      }
      panel.setMode("transcript");
      panel.setTranslationAvailable(
        !isTranscriptInOutputLanguage(transcript.languageCode, outputLanguage),
      );
      panel.setTranslationActionsBusy(this.session.isTranslating);
      this.render(panel, !shouldSyncToPlayback);
      if (shouldSyncToPlayback) {
        const targetChunkId = this.activeChunkId;
        requestAnimationFrame(() => {
          if (
            stateVersion !== this.session.version ||
            this.host.currentPanel() !== panel ||
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
            this.scrollTop = content.scrollTop;
          }
        });
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      handleError(err, panel);
    }
  }

  setView(view: TranscriptView): void {
    this.view = view;
    this.render(this.host.getPanel());
  }

  translateCurrent(forceRefresh: boolean): void {
    const panel = this.host.getPanel();
    this.session.requestTranslation(panel, [this.activeChunkId], forceRefresh, false, () => {
      this.view = "translation";
      panel.setTranscriptView("translation");
    });
  }

  translateAll(forceRefresh: boolean): void {
    this.session.requestTranslation(
      this.host.getPanel(),
      this.session.chunks.map((chunk) => chunk.id),
      forceRefresh,
      true,
      () => {},
    );
  }

  private updateToolbar(panel: Panel): void {
    const transcript = this.session.transcript;
    const chunks = this.session.chunks;
    if (!transcript || !chunks.length) return;
    const chunk = chunks[this.activeChunkId];
    const first = transcript.segments[chunk.targetStart];
    const last = transcript.segments[chunk.targetEnd];
    panel.setTranscriptRange(
      t("sectionRange", [
        String(this.activeChunkId + 1),
        String(chunks.length),
        formatTime(first.start),
        formatTime(last.start + last.duration),
      ]),
    );
    panel.setCurrentSectionTranslated(this.session.isChunkTranslated(chunk));
    panel.setAllSectionsTranslated(chunks.every((item) => this.session.isChunkTranslated(item)));
    panel.setTranscriptView(this.view);
    panel.setTranslationProgress(this.session.progressText);
  }

  private updateActiveChunkFromScroll(panel: Panel): void {
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
    if (!Number.isInteger(next) || next === this.activeChunkId) return;
    this.activeChunkId = next;
    for (const section of sections) {
      section.classList.toggle("vas-current-section", Number(section.dataset.chunkId) === next);
    }
    this.updateToolbar(panel);
  }

  private handleScroll(panel: Panel): void {
    if (panel.getMode() !== "transcript" || !this.session.chunks.length) return;
    const content = panel.getContentElement();
    if (content.scrollTop < 80 && this.loadedChunkStart > 0) {
      const oldHeight = content.scrollHeight;
      this.loadedChunkStart -= 1;
      this.render(panel, false);
      content.scrollTop = content.scrollHeight - oldHeight + 80;
    } else if (
      content.scrollTop + content.clientHeight > content.scrollHeight - 80 &&
      this.loadedChunkEnd < this.session.chunks.length - 1
    ) {
      this.loadedChunkEnd += 1;
      this.render(panel, true);
    }
    this.updateActiveChunkFromScroll(panel);
    this.scrollTop = content.scrollTop;
  }

  private handleWheel(panel: Panel, event: WheelEvent): void {
    if (panel.getMode() !== "transcript" || !this.session.chunks.length) return;
    const content = panel.getContentElement();
    const direction = getTranscriptLazyLoadDirection({
      deltaY: event.deltaY,
      scrollTop: content.scrollTop,
      clientHeight: content.clientHeight,
      scrollHeight: content.scrollHeight,
      loadedStart: this.loadedChunkStart,
      loadedEnd: this.loadedChunkEnd,
      totalChunks: this.session.chunks.length,
    });
    if (!direction) return;

    event.preventDefault();
    event.stopPropagation();
    const oldHeight = content.scrollHeight;
    const oldTop = content.scrollTop;
    if (direction === "after") this.loadedChunkEnd += 1;
    else this.loadedChunkStart -= 1;
    this.render(panel, false);

    const addedHeight = content.scrollHeight - oldHeight;
    const nextTop = direction === "after"
      ? oldTop + Math.max(1, event.deltaY)
      : oldTop + addedHeight + Math.min(-1, event.deltaY);
    content.scrollTop = Math.max(
      0,
      Math.min(content.scrollHeight - content.clientHeight, nextTop),
    );
    this.scrollTop = content.scrollTop;
    this.updateActiveChunkFromScroll(panel);
  }
}
