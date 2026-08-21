import {
  getSubtitleContainerCssValues,
  getSubtitleTypographyCssValues,
  type SubtitleStyleSettings,
} from "../../service/subtitle-style";

export interface BilingualOverlayCue {
  sourceText: string;
  translationText?: string;
  statusText?: string;
  retryText?: string;
}

export interface BilingualOverlayVisibility {
  showSource: boolean;
  showTranslation: boolean;
  showStatus: boolean;
  showRetry: boolean;
}

export function getBilingualOverlayVisibility(
  cue: BilingualOverlayCue,
  options: { learningMode: boolean; translationOnly: boolean; hovered: boolean },
): BilingualOverlayVisibility {
  const hasTranslationDetails = Boolean(
    cue.translationText || cue.statusText || cue.retryText,
  );
  const showDetails = options.translationOnly || !options.learningMode || options.hovered;
  return {
    // When no translation is required, the source is already the desired output.
    showSource: !options.translationOnly || !hasTranslationDetails,
    showTranslation: showDetails && Boolean(cue.translationText),
    showStatus: showDetails && Boolean(cue.statusText),
    showRetry: showDetails && Boolean(cue.retryText),
  };
}

const PLAYER_ACTIVE_CLASS = "vas-bilingual-subtitles-active";
const NATIVE_CAPTION_STYLE_ID = "vas-bilingual-native-caption-style";

function ensureNativeCaptionStyle(): void {
  if (document.getElementById(NATIVE_CAPTION_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = NATIVE_CAPTION_STYLE_ID;
  style.textContent = `
    .${PLAYER_ACTIVE_CLASS} .ytp-caption-window-container {
      visibility: hidden !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

/** Player-local bilingual subtitle UI. Text selection freezes DOM replacement. */
export class BilingualSubtitleOverlay {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private card: HTMLDivElement;
  private sourceEl: HTMLDivElement;
  private translationEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private retryEl: HTMLButtonElement;
  private player: HTMLElement;
  private pendingCue: BilingualOverlayCue | null = null;
  private renderedCue: BilingualOverlayCue | null = null;
  private selectionFrozen = false;
  private learningMode = false;
  private translationOnly = false;
  private hovered = false;
  private readonly onSelectionChange: () => void;

  constructor(player: HTMLElement, onRetry?: () => void) {
    this.player = player;
    ensureNativeCaptionStyle();

    this.host = document.createElement("div");
    this.host.id = "vas-bilingual-overlay";
    Object.assign(this.host.style, {
      position: "absolute",
      inset: "0",
      zIndex: "61",
      pointerEvents: "none",
      overflow: "hidden",
    });
    this.shadow = this.host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host {
        --vas-source-font-size: clamp(15px, 1.65vw, 24px);
        --vas-translation-font-size: clamp(17px, 1.9vw, 28px);
        --vas-source-color: #dbdbdb;
        --vas-translation-color: #fff;
        --vas-caption-background: rgba(8, 8, 8, .76);
        --vas-caption-shadow: 0 2px 12px rgba(0, 0, 0, .22);
        --vas-caption-max-width: 100%;
        font-family: Roboto, Arial, sans-serif;
      }
      .wrap {
        position: absolute;
        left: 50%;
        bottom: max(72px, 11%);
        transform: translateX(-50%);
        width: min(92%, 1120px);
        display: flex;
        justify-content: center;
        pointer-events: none;
      }
      .card {
        max-width: var(--vas-caption-max-width);
        padding: 7px 13px 8px;
        border-radius: 7px;
        background: var(--vas-caption-background);
        color: #fff;
        text-align: center;
        text-shadow: 0 1px 2px rgba(0, 0, 0, .95);
        box-shadow: var(--vas-caption-shadow);
        pointer-events: auto;
        cursor: text;
        user-select: text;
        -webkit-user-select: text;
        overflow-wrap: anywhere;
      }
      .source {
        color: var(--vas-source-color);
        font-size: var(--vas-source-font-size);
        line-height: 1.32;
        white-space: pre-wrap;
      }
      .translation {
        margin-top: 4px;
        color: var(--vas-translation-color);
        font-size: var(--vas-translation-font-size);
        font-weight: 600;
        line-height: 1.32;
        white-space: pre-wrap;
      }
      .status {
        margin-top: 4px;
        color: rgba(255, 255, 255, .65);
        font-size: clamp(12px, 1.1vw, 15px);
        line-height: 1.25;
      }
      .retry {
        margin: 6px 0 0;
        padding: 4px 10px;
        border: 1px solid rgba(255, 255, 255, .5);
        border-radius: 999px;
        background: rgba(255, 255, 255, .12);
        color: #fff;
        font: inherit;
        font-size: clamp(12px, 1.1vw, 15px);
        line-height: 1.25;
        cursor: pointer;
      }
      .retry:hover { background: rgba(255, 255, 255, .24); }
      .retry:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      .hidden { display: none; }
      @media (max-width: 640px) {
        .wrap { bottom: max(56px, 10%); width: 96%; }
        .card { padding: 5px 9px 6px; }
      }
    `;
    this.shadow.appendChild(style);

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    this.card = document.createElement("div");
    this.card.className = "card hidden";
    this.sourceEl = document.createElement("div");
    this.sourceEl.className = "source";
    this.translationEl = document.createElement("div");
    this.translationEl.className = "translation hidden";
    this.statusEl = document.createElement("div");
    this.statusEl.className = "status hidden";
    this.statusEl.setAttribute("role", "status");
    this.retryEl = document.createElement("button");
    this.retryEl.type = "button";
    this.retryEl.className = "retry hidden";
    this.retryEl.addEventListener("click", () => onRetry?.());
    this.card.addEventListener("mouseenter", () => {
      this.hovered = true;
      this.renderPendingCue();
    });
    this.card.addEventListener("mouseleave", () => {
      this.hovered = false;
      this.renderPendingCue();
    });
    this.card.append(this.sourceEl, this.translationEl, this.statusEl, this.retryEl);
    wrap.appendChild(this.card);
    this.shadow.appendChild(wrap);
    player.appendChild(this.host);

    this.onSelectionChange = () => this.handleSelectionChange();
    document.addEventListener("selectionchange", this.onSelectionChange);
  }

  setSourceReady(ready: boolean): void {
    this.player.classList.toggle(PLAYER_ACTIVE_CLASS, ready);
  }

  setLearningMode(enabled: boolean): void {
    if (this.learningMode === enabled) return;
    this.learningMode = enabled;
    this.renderedCue = null;
    if (!this.selectionFrozen) this.renderPendingCue();
  }

  setTranslationOnly(enabled: boolean): void {
    if (this.translationOnly === enabled) return;
    this.translationOnly = enabled;
    this.renderedCue = null;
    if (!this.selectionFrozen) this.renderPendingCue();
  }

  setStyle(settings: SubtitleStyleSettings): void {
    const values = getSubtitleTypographyCssValues(settings);
    const container = getSubtitleContainerCssValues(settings);
    this.host.style.setProperty("--vas-source-font-size", values.sourceFontSize);
    this.host.style.setProperty("--vas-translation-font-size", values.translationFontSize);
    this.host.style.setProperty("--vas-source-color", values.sourceColor);
    this.host.style.setProperty("--vas-translation-color", values.translationColor);
    this.host.style.setProperty("--vas-caption-background", container.background);
    this.host.style.setProperty("--vas-caption-shadow", container.boxShadow);
    this.host.style.setProperty("--vas-caption-max-width", container.maxWidth);
  }

  setCue(cue: BilingualOverlayCue | null): void {
    this.pendingCue = cue;
    if (!this.selectionFrozen) this.renderPendingCue();
  }

  destroy(): void {
    document.removeEventListener("selectionchange", this.onSelectionChange);
    this.player.classList.remove(PLAYER_ACTIVE_CLASS);
    this.host.remove();
  }

  private handleSelectionChange(): void {
    const selection = document.getSelection();
    const frozen = Boolean(
      selection &&
      !selection.isCollapsed &&
      (selection.anchorNode?.getRootNode() === this.shadow ||
        selection.focusNode?.getRootNode() === this.shadow),
    );
    if (frozen === this.selectionFrozen) return;
    this.selectionFrozen = frozen;
    if (!frozen) this.renderPendingCue();
  }

  private renderPendingCue(): void {
    const cue = this.pendingCue;
    if (
      cue === this.renderedCue ||
      (cue && this.renderedCue &&
        cue.sourceText === this.renderedCue.sourceText &&
        cue.translationText === this.renderedCue.translationText &&
        cue.statusText === this.renderedCue.statusText &&
        cue.retryText === this.renderedCue.retryText &&
        !this.learningMode)
    ) return;
    this.renderedCue = cue ? { ...cue } : null;
    if (!cue?.sourceText) {
      this.card.classList.add("hidden");
      this.sourceEl.textContent = "";
      this.translationEl.textContent = "";
      this.statusEl.textContent = "";
      this.retryEl.textContent = "";
      return;
    }

    this.card.classList.remove("hidden");
    this.sourceEl.textContent = cue.sourceText;
    const visibility = getBilingualOverlayVisibility(cue, {
      learningMode: this.learningMode,
      translationOnly: this.translationOnly,
      hovered: this.hovered,
    });
    this.sourceEl.classList.toggle("hidden", !visibility.showSource);
    this.translationEl.textContent = cue.translationText ?? "";
    this.translationEl.classList.toggle("hidden", !visibility.showTranslation);
    this.statusEl.textContent = cue.statusText ?? "";
    this.statusEl.classList.toggle("hidden", !visibility.showStatus);
    this.retryEl.textContent = cue.retryText ?? "";
    this.retryEl.classList.toggle("hidden", !visibility.showRetry);
  }
}
