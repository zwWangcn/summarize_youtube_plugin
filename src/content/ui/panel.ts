/**
 * 浮层 Panel UI 组件 — 面板用 Shadow DOM 隔离样式，触发按钮用普通 DOM。
 *
 * 架构：
 *   - 触发按钮（trigger）：普通 DOM 元素，注入到视频播放器容器
 *   - 面板（panel）：Shadow DOM，注入到 <body>（position: fixed）
 *
 * 生命周期：
 *   1. 构造函数 → createTrigger() + attach Shadow DOM + 导入样式
 *   2. injectTrigger(parent) → 将触发按钮注入播放器
 *   3. bindToPlayer(playerEl) → 绑定 hover 显隐
 *   4. injectPanel(parent) → 将面板注入页面（默认 body）
 *   5. 用户交互 → 调用外部注入的回调函数
 *   6. destroy() → 从 DOM 中移除 trigger 和 panel
 */

import panelStyles from "./styles.css?inline";
import { linkifyTimestampsInDom } from "./renderer";
import { t } from "../../utils/i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type PanelMode = "idle" | "loading" | "summary" | "transcript" | "error";
export type TranscriptView = "source" | "translation";

export interface PanelCallbacks {
  onSummarize: () => void;
  onTranslateSummary?: () => void;
  onTranscript: (withTimestamps: boolean) => void;
  onTranscriptViewChange?: (view: TranscriptView) => void;
  onTranslateCurrent?: (forceRefresh: boolean) => void;
  onTranslateAll?: () => void;
  onClose: () => void;
  /** 点击总结中的时间戳时触发，参数为跳转秒数。 */
  onSeek?: (seconds: number) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULT_PANEL_WIDTH = 420;
const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 800;
const PANEL_WIDTH_STORAGE_KEY = "vas-panel-width";

// ---------------------------------------------------------------------------
// Panel class
// ---------------------------------------------------------------------------
export class Panel {
  private shadow: ShadowRoot;
  private container: HTMLDivElement;   // panel Shadow DOM host
  private trigger: HTMLButtonElement;  // trigger button (no Shadow DOM)
  private panel: HTMLDivElement;
  private contentEl: HTMLElement;
  private loadingEl: HTMLElement;
  private elapsedEl: HTMLElement;
  private errorEl: HTMLElement;
  private warningEl: HTMLElement;
  private titleEl: HTMLElement;
  private summarizeBtn: HTMLButtonElement;
  private summaryTranslateBtn: HTMLButtonElement;
  private transcriptBtn: HTMLButtonElement;
  private transcriptTools: HTMLElement;
  private sourceViewBtn: HTMLButtonElement;
  private translationViewBtn: HTMLButtonElement;
  private translateCurrentBtn: HTMLButtonElement;
  private translateAllBtn: HTMLButtonElement;
  private transcriptRangeEl: HTMLElement;
  private translationProgressEl: HTMLElement;
  private copyBtn: HTMLButtonElement;
  private timestampToggle: HTMLElement;
  private timestampCheckbox: HTMLInputElement;
  private callbacks: PanelCallbacks;
  private mode: PanelMode = "idle";
  private translationAvailable = true;
  private summaryTranslationVisible = false;
  private summaryTranslationBusy = false;
  private summaryTranslationAttention = false;
  private summaryTranslationTarget = "";
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;

  private isCachedView = false;
  private cacheHintEl: HTMLElement | null = null;

  // Bind-to-player lifecycle
  private boundPlayer: HTMLElement | null = null;
  private boundPlayerShow: (() => void) | null = null;
  private boundPlayerHide: (() => void) | null = null;
  private playerHideTimer: ReturnType<typeof setTimeout> | null = null;

  // Resize
  private resizeHandle!: HTMLDivElement;
  private resetWidthBtn!: HTMLButtonElement;
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private boundMouseMove: ((e: MouseEvent) => void) | null = null;
  private boundMouseUp: ((e: MouseEvent) => void) | null = null;
  private isResizing = false;
  private previousBodyUserSelect = "";
  private previousBodyCursor = "";

  constructor(callbacks: PanelCallbacks) {
    this.callbacks = callbacks;

    // ── Create trigger button (plain DOM element, no Shadow DOM) ──
    this.trigger = this.createTrigger();

    // ── Create panel container (Shadow DOM) ──
    this.container = document.createElement("div");
    this.container.id = "vas-root";
    this.container.style.position = "fixed";
    this.container.style.zIndex = "2147483647";

    // Attach Shadow DOM
    this.shadow = this.container.attachShadow({ mode: "open" });

    // Inject styles
    const style = document.createElement("style");
    style.textContent = panelStyles;
    this.shadow.appendChild(style);

    // Build panel (no trigger in Shadow DOM)
    this.panel = this.buildPanel();
    this.shadow.appendChild(this.panel);

    // Cache refs
    this.titleEl = this.panel.querySelector(".vas-header-title")!;
    this.contentEl = this.panel.querySelector(".vas-content")!;
    this.loadingEl = this.panel.querySelector(".vas-loading")!;
    this.elapsedEl = this.panel.querySelector(".vas-elapsed")!;
    this.errorEl = this.panel.querySelector(".vas-error")!;
    this.warningEl = this.panel.querySelector(".vas-warning")!;
    this.summarizeBtn = this.panel.querySelector(".vas-btn-summarize")!;
    this.summaryTranslateBtn = this.panel.querySelector(".vas-btn-summary-translate")!;
    this.transcriptBtn = this.panel.querySelector(".vas-btn-transcript")!;
    this.transcriptTools = this.panel.querySelector(".vas-transcript-tools")!;
    this.sourceViewBtn = this.panel.querySelector(".vas-view-source")!;
    this.translationViewBtn = this.panel.querySelector(".vas-view-translation")!;
    this.translateCurrentBtn = this.panel.querySelector(".vas-translate-current")!;
    this.translateAllBtn = this.panel.querySelector(".vas-translate-all")!;
    this.transcriptRangeEl = this.panel.querySelector(".vas-transcript-range")!;
    this.translationProgressEl = this.panel.querySelector(".vas-translation-progress")!;
    this.copyBtn = this.panel.querySelector(".vas-btn-copy")!;
    this.timestampToggle = this.panel.querySelector(".vas-timestamp-toggle")!;
    this.timestampCheckbox = this.panel.querySelector(".vas-timestamp-checkbox")!;
    this.cacheHintEl = this.panel.querySelector(".vas-cache-hint")!;
    this.resizeHandle = this.panel.querySelector(".vas-resize-handle")!;
    this.resetWidthBtn = this.panel.querySelector(".vas-btn-reset-width")!;
    if (!this.callbacks.onTranslateCurrent) this.transcriptTools.style.display = "none";

    this.attachEvents();
    this.setMode("idle");
  }

  // -----------------------------------------------------------------------
  // Build DOM
  // -----------------------------------------------------------------------

  /**
   * 创建触发按钮 — 悬浮在视频播放器右上角，跟随播放器 hover 状态显隐。
   */
  private createTrigger(): HTMLButtonElement {
    const btn = document.createElement("button");

    Object.assign(btn.style, {
      position: "absolute",
      top: "12px",
      right: "12px",
      zIndex: "99",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      height: "36px",
      padding: "0 14px",
      border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: "8px",
      background: "rgba(0, 0, 0, 0.65)",
      color: "#fff",
      fontFamily: '"Roboto", "Arial", sans-serif',
      fontSize: "13px",
      fontWeight: "500",
      cursor: "pointer",
      whiteSpace: "nowrap",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      transition: "opacity 0.3s ease, background 0.2s",
    });

    btn.textContent = t("aiSummary");
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "rgba(0, 0, 0, 0.8)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "rgba(0, 0, 0, 0.65)";
    });
    btn.addEventListener("click", () => this.open());
    return btn;
  }

  /**
   * 绑定按钮到播放器的 hover 状态：鼠标在播放器上时显示，移开时隐藏。
   * 与 YouTube 原生控制栏的显示/隐藏行为同步。
   */
  bindToPlayer(playerEl: HTMLElement): void {
    // Clean up previous bindings first (e.g., after SPA rebuild)
    this.unbindPlayer();

    const show = () => {
      if (this.playerHideTimer) {
        clearTimeout(this.playerHideTimer);
        this.playerHideTimer = null;
      }
      this.trigger.style.opacity = "1";
      this.trigger.style.pointerEvents = "auto";
    };

    const hide = () => {
      this.playerHideTimer = setTimeout(() => {
        this.trigger.style.opacity = "0";
        this.trigger.style.pointerEvents = "none";
        this.playerHideTimer = null;
      }, 300);  // 小延迟，防止鼠标短暂离开时闪烁
    };

    playerEl.addEventListener("mouseenter", show);
    playerEl.addEventListener("mouseleave", hide);
    playerEl.addEventListener("mousemove", show);  // 每次移动都重置计时器

    // 保存引用以便 destroy 时清理
    this.boundPlayer = playerEl;
    this.boundPlayerShow = show;
    this.boundPlayerHide = hide;

    // 初始状态：隐藏
    this.trigger.style.opacity = "0";
    this.trigger.style.pointerEvents = "none";
  }

  /** 清理 bindToPlayer 绑定的事件监听器。 */
  private unbindPlayer(): void {
    if (this.playerHideTimer) {
      clearTimeout(this.playerHideTimer);
      this.playerHideTimer = null;
    }
    if (!this.boundPlayer) return;
    if (this.boundPlayerShow) {
      this.boundPlayer.removeEventListener("mouseenter", this.boundPlayerShow);
      this.boundPlayer.removeEventListener("mousemove", this.boundPlayerShow);
    }
    if (this.boundPlayerHide) {
      this.boundPlayer.removeEventListener("mouseleave", this.boundPlayerHide);
    }
    this.boundPlayer = null;
    this.boundPlayerShow = null;
    this.boundPlayerHide = null;
  }

  private buildPanel(): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "vas-panel vas-collapsed";
    el.innerHTML = `
      <div class="vas-header">
        <span class="vas-header-title">${t("extensionName")}</span>
        <div class="vas-header-actions">
          <button class="vas-btn-icon vas-btn-reset-width" title="${t("resetWidthTitle")}" style="display:none">↺</button>
          <button class="vas-btn-icon vas-btn-close" title="${t("closeTitle")}">✕</button>
        </div>
      </div>
      <div class="vas-toolbar">
        <button class="vas-btn vas-btn-primary vas-btn-summarize">${t("aiSummary")}</button>
        <button class="vas-btn vas-btn-transcript">${t("rawTranscript")}</button>
        <button class="vas-btn vas-btn-summary-translate" style="display:none"></button>
        <span class="vas-toolbar-spacer"></span>
        <label class="vas-toggle-label vas-timestamp-toggle" style="display:none">
          <input type="checkbox" class="vas-timestamp-checkbox" checked /> ${t("timestamp")}
        </label>
        <button class="vas-btn vas-btn-copy" title="${t("copy")}" style="display:none">${t("copy")}</button>
      </div>
      <div class="vas-transcript-tools" style="display:none">
        <div class="vas-view-switch" role="group" aria-label="${t("captionLanguageAria")}">
          <button class="vas-view-option vas-view-source vas-active">${t("sourceView")}</button>
          <button class="vas-view-option vas-view-translation">${t("translationView")}</button>
        </div>
        <span class="vas-transcript-range"></span>
        <span class="vas-transcript-tools-spacer"></span>
        <button class="vas-btn vas-translate-current">${t("translateSection")}</button>
        <button class="vas-btn vas-translate-all">${t("translateAll")}</button>
        <span class="vas-translation-progress"></span>
      </div>
      <div class="vas-error" style="display:none"></div>
      <div class="vas-warning" style="display:none"></div>
      <div class="vas-loading" style="display:none">
        <div class="vas-spinner"></div>
        <span class="vas-loading-msg">${t("starting")}</span>
        <span class="vas-elapsed"></span>
      </div>
      <div class="vas-cache-hint" style="display:none"></div>
      <div class="vas-content" style="display:none"></div>
      <div class="vas-resize-handle"></div>
    `;
    return el;
  }

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  private attachEvents(): void {
    // Close button
    this.panel.querySelector(".vas-btn-close")?.addEventListener("click", () => this.close());
    // Summarize button
    this.summarizeBtn.addEventListener("click", () => this.callbacks.onSummarize());
    this.summaryTranslateBtn.addEventListener(
      "click",
      () => this.callbacks.onTranslateSummary?.(),
    );
    // Transcript button
    this.transcriptBtn.addEventListener("click", () => {
      this.timestampToggle.style.display = "flex";
      this.callbacks.onTranscript(this.timestampCheckbox.checked);
    });
    this.sourceViewBtn.addEventListener("click", () => {
      this.setTranscriptView("source");
      this.callbacks.onTranscriptViewChange?.("source");
    });
    this.translationViewBtn.addEventListener("click", () => {
      this.setTranscriptView("translation");
      this.callbacks.onTranscriptViewChange?.("translation");
    });
    this.translateCurrentBtn.addEventListener("click", () => {
      this.callbacks.onTranslateCurrent?.(
        this.translateCurrentBtn.dataset.translated === "true",
      );
    });
    this.translateAllBtn.addEventListener("click", () => this.callbacks.onTranslateAll?.());
    // Copy button
    this.copyBtn.addEventListener("click", () => this.copyContent());
    // Timestamp toggle
    this.timestampCheckbox.addEventListener("change", () => {
      if (this.mode === "transcript") {
        this.callbacks.onTranscript(this.timestampCheckbox.checked);
      }
    });
    // Resize handle
    this.resizeHandle.addEventListener("mousedown", (e) => this.startResize(e));
    // Reset width button
    this.resetWidthBtn.addEventListener("click", () => this.resetPanelWidth());
    // 时间戳点击跳转（事件委托——缓存视图与流式渲染都写入 contentEl，共用此监听器；
    // 流式每次重建 innerHTML 不影响父级监听）
    this.contentEl.addEventListener("click", (e) => {
      const tsEl = (e.target as HTMLElement).closest<HTMLElement>(".vas-ts");
      if (!tsEl) return;
      const seconds = Number(tsEl.getAttribute("data-seconds"));
      if (Number.isFinite(seconds)) this.callbacks.onSeek?.(seconds);
    });
  }

  // -----------------------------------------------------------------------
  // Public API — Injection
  // -----------------------------------------------------------------------

  /** 获取触发按钮元素（普通 DOM，注入到播放器容器）。 */
  getTrigger(): HTMLButtonElement {
    return this.trigger;
  }

  /** 获取面板容器元素（Shadow DOM host，注入到 body）。 */
  getPanelContainer(): HTMLDivElement {
    return this.container;
  }

  /** 将触发按钮注入到指定父元素。 */
  injectTrigger(target: HTMLElement): void {
    target.appendChild(this.trigger);
  }

  /** 将面板注入到指定父元素（默认 body）。 */
  injectPanel(target: HTMLElement = document.body): void {
    target.appendChild(this.container);
  }

  /** 从 DOM 中移除 UI。 */
  destroy(): void {
    this.stopElapsedTimer();
    this.unbindPlayer();
    this.cleanupResize();
    if (this.trigger.parentNode) {
      this.trigger.remove();
    }
    if (this.container.parentNode) {
      this.container.remove();
    }
  }

  /** 获取当前模式。 */
  getMode(): PanelMode {
    return this.mode;
  }

  /** 获取内容容器元素，供外部渲染器直接操作。 */
  getContentElement(): HTMLElement {
    return this.contentEl;
  }

  // ---- Theme ----

  /**
   * 设置面板主题。
   * @param isDark true = 暗色模式，false = 亮色模式
   */
  setTheme(isDark: boolean): void {
    this.container.classList.toggle("vas-theme-light", !isDark);
    this.container.classList.toggle("vas-theme-dark", isDark);
  }

  // ---- Cache-aware button ----

  /** 切换总结按钮文字。 */
  setSummarizeButtonText(text: string): void {
    this.summarizeBtn.textContent = text;
  }

  /** 显示缓存时间提示（如「缓存于 2 小时前」）。 */
  showCacheHint(message: string): void {
    if (this.cacheHintEl) {
      this.cacheHintEl.textContent = message;
      this.cacheHintEl.style.display = "block";
    }
  }

  /** 隐藏缓存时间提示。 */
  hideCacheHint(): void {
    if (this.cacheHintEl) {
      this.cacheHintEl.style.display = "none";
    }
  }

  /** 标记当前是否显示的是缓存内容。 */
  setCachedView(cached: boolean): void {
    this.isCachedView = cached;
  }

  /** 是否正在显示缓存内容。 */
  getIsCachedView(): boolean {
    return this.isCachedView;
  }

  // ---- Visibility ----

  open(): void {
    this.panel.classList.remove("vas-collapsed");
    this.trigger.style.display = "none";
  }

  close(): void {
    this.panel.classList.add("vas-collapsed");
    this.trigger.style.display = "";
    this.callbacks.onClose();
  }

  reset(): void {
    this.close();
    this.panel.style.minHeight = "";
    this.contentEl.replaceChildren();
    this.setMode("idle");
    this.timestampToggle.style.display = "none";
    this.copyBtn.style.display = "none";
    this.setTranslationActionsBusy(false);
    this.hideSummaryTranslationAction();
    this.isCachedView = false;
    this.setSummarizeButtonText(t("aiSummary"));
    this.setTranscriptView("source");
    this.setTranslationProgress("");
    this.hideCacheHint();
  }

  // ---- Streaming ----

  /**
   * 从 loading 状态切换到流式内容展示：隐藏加载指示器，显示内容区域。
   * 调用后，外部可逐 chunk 写入 contentEl 实现 token 级别流式渲染。
   */
  beginStreaming(): void {
    // 释放 loading 模式时保持的 min-height
    this.panel.style.minHeight = "";
    // 清空旧内容（如字幕原文），避免切换时闪烁
    this.contentEl.innerHTML = `
      <div class="vas-thinking">
        <div class="vas-thinking-dot"></div>
        <span>${t("aiThinking")}</span>
      </div>`;
    this.loadingEl.style.display = "none";
    this.contentEl.style.display = "block";
    this.stopElapsedTimer();
  }

  // ---- State ----

  setMode(mode: PanelMode): void {
    // 从内容模式切换到 loading 时，保持当前面板高度防止跳动
    if (mode === "loading" && (
      this.mode === "summary" ||
      this.mode === "transcript"
    )) {
      const currentHeight = this.panel.getBoundingClientRect().height;
      if (currentHeight > 120) {
        this.panel.style.minHeight = `${currentHeight}px`;
      }
    }

    this.mode = mode;
    this.hideAll();

    switch (mode) {
      case "idle":
        this.setButtonsDisabled(false);
        this.stopElapsedTimer();
        break;
      case "loading":
        this.loadingEl.style.display = "flex";
        this.setButtonsDisabled(true);
        this.startElapsedTimer();
        break;
      case "summary":
        this.contentEl.style.display = "block";
        this.summaryTranslateBtn.style.display =
          this.summaryTranslationVisible ? "inline-flex" : "none";
        this.copyBtn.style.display = "inline-flex";
        this.timestampToggle.style.display = "none";
        this.setButtonsDisabled(false);
        this.stopElapsedTimer();
        break;
      case "transcript":
        this.contentEl.style.display = "block";
        if (this.callbacks.onTranslateCurrent && this.translationAvailable) {
          this.transcriptTools.style.display = "flex";
        }
        this.copyBtn.style.display = "inline-flex";
        this.timestampToggle.style.display = "flex";
        this.setButtonsDisabled(false);
        this.stopElapsedTimer();
        break;
      case "error":
        this.setButtonsDisabled(false);
        this.stopElapsedTimer();
        break;
    }
  }

  // ---- Content ----

  setTitle(title: string): void {
    this.titleEl.textContent = title;
  }

  setLoadingMessage(msg: string): void {
    const el = this.panel.querySelector(".vas-loading-msg") as HTMLElement;
    if (el) el.textContent = msg;
  }

  setContent(html: string): void {
    this.contentEl.innerHTML = html;
    linkifyTimestampsInDom(this.contentEl);
    this.contentEl.scrollTop = this.contentEl.scrollHeight;
  }

  showError(message: string): void {
    this.setMode("error");
    this.errorEl.textContent = message;
    this.errorEl.style.display = "block";
  }

  showWarning(message: string): void {
    this.warningEl.textContent = message;
    this.warningEl.style.display = "block";
  }

  // ---- Buttons ----

  setButtonsDisabled(disabled: boolean): void {
    this.summarizeBtn.disabled = disabled;
    this.transcriptBtn.disabled = disabled;
    this.summaryTranslateBtn.disabled = disabled || this.summaryTranslationBusy;
  }

  showSummaryTranslationAction(targetLanguage: string): void {
    this.summaryTranslationTarget = targetLanguage;
    this.summaryTranslationVisible = true;
    this.summaryTranslateBtn.textContent = t("translateSummaryTo", targetLanguage);
    this.summaryTranslateBtn.style.display = this.mode === "summary" ? "inline-flex" : "none";
    this.summaryTranslateBtn.disabled = this.summaryTranslationBusy;
  }

  hideSummaryTranslationAction(): void {
    this.summaryTranslationVisible = false;
    this.summaryTranslationBusy = false;
    this.summaryTranslationAttention = false;
    this.summaryTranslationTarget = "";
    this.summaryTranslateBtn.style.display = "none";
    this.summaryTranslateBtn.classList.remove("vas-language-mismatch");
    this.summaryTranslateBtn.disabled = false;
  }

  setSummaryTranslationAttention(attention: boolean): void {
    this.summaryTranslationAttention = attention;
    this.summaryTranslateBtn.classList.remove("vas-language-mismatch");
    if (attention && !this.summaryTranslationBusy) {
      // Restart the finite pulse when a new detection result reports a mismatch.
      void this.summaryTranslateBtn.offsetWidth;
      this.summaryTranslateBtn.classList.add("vas-language-mismatch");
    }
  }

  setSummaryTranslationBusy(busy: boolean): void {
    this.summaryTranslationBusy = busy;
    this.summaryTranslateBtn.disabled = busy;
    this.summaryTranslateBtn.textContent = busy
      ? t("translatingSummaryTo", this.summaryTranslationTarget)
      : t("translateSummaryTo", this.summaryTranslationTarget);
    this.summaryTranslateBtn.classList.toggle(
      "vas-language-mismatch",
      this.summaryTranslationAttention && !busy,
    );
  }

  setTranslationAvailable(available: boolean): void {
    this.translationAvailable = available;
    this.transcriptTools.style.display =
      available && this.mode === "transcript" ? "flex" : "none";
  }

  setTranscriptView(view: TranscriptView): void {
    this.sourceViewBtn.classList.toggle("vas-active", view === "source");
    this.translationViewBtn.classList.toggle("vas-active", view === "translation");
  }

  setTranscriptRange(text: string): void {
    this.transcriptRangeEl.textContent = text;
  }

  setCurrentSectionTranslated(translated: boolean): void {
    this.translateCurrentBtn.dataset.translated = String(translated);
    this.translateCurrentBtn.textContent = t(
      translated ? "retranslateSection" : "translateSection",
    );
  }

  setTranslationActionsBusy(busy: boolean): void {
    this.translateCurrentBtn.disabled = busy;
    this.translateAllBtn.disabled = busy;
  }

  setTranslationProgress(text: string): void {
    this.translationProgressEl.textContent = text;
    this.translationProgressEl.style.display = text ? "" : "none";
  }

  // ---- Copy ----

  private async copyContent(): Promise<void> {
    const text = this.contentEl.textContent ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    this.showToast(t("copied"));
  }

  private showToast(message: string): void {
    const toast = document.createElement("div");
    toast.className = "vas-toast";
    toast.textContent = message;
    this.shadow.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
  }

  // ---- Resize ----

  /** 开始拖拽调整宽度。 */
  private startResize(e: MouseEvent): void {
    e.preventDefault();
    this.cleanupResize();
    this.resizeStartX = e.clientX;
    this.resizeStartWidth = this.panel.getBoundingClientRect().width;

    this.boundMouseMove = (ev: MouseEvent) => this.onResizeMouseMove(ev);
    this.boundMouseUp = () => this.onResizeMouseUp();

    this.previousBodyUserSelect = document.body.style.userSelect;
    this.previousBodyCursor = document.body.style.cursor;
    this.isResizing = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ew-resize";

    document.addEventListener("mousemove", this.boundMouseMove);
    document.addEventListener("mouseup", this.boundMouseUp);
  }

  private onResizeMouseMove(e: MouseEvent): void {
    const delta = this.resizeStartX - e.clientX;
    let newWidth = this.resizeStartWidth + delta;
    const viewportMaximum = Math.max(240, Math.min(MAX_PANEL_WIDTH, window.innerWidth - 24));
    const viewportMinimum = Math.min(MIN_PANEL_WIDTH, viewportMaximum);
    newWidth = Math.max(viewportMinimum, Math.min(viewportMaximum, newWidth));
    this.panel.style.width = `${newWidth}px`;
  }

  private onResizeMouseUp(): void {
    this.cleanupResize();

    // 持久化宽度
    const finalWidth = this.panel.getBoundingClientRect().width;
    Panel.savePanelWidth(Math.round(finalWidth));
    this.updateResetButtonVisibility();
  }

  private cleanupResize(): void {
    if (!this.isResizing) return;
    this.isResizing = false;
    document.body.style.userSelect = this.previousBodyUserSelect;
    document.body.style.cursor = this.previousBodyCursor;

    if (this.boundMouseMove) {
      document.removeEventListener("mousemove", this.boundMouseMove);
      this.boundMouseMove = null;
    }
    if (this.boundMouseUp) {
      document.removeEventListener("mouseup", this.boundMouseUp);
      this.boundMouseUp = null;
    }

  }

  /** 显示/隐藏恢复默认宽度按钮。 */
  private updateResetButtonVisibility(): void {
    const currentWidth = this.panel.style.width
      ? parseInt(this.panel.style.width, 10)
      : DEFAULT_PANEL_WIDTH;
    this.resetWidthBtn.style.display =
      currentWidth !== DEFAULT_PANEL_WIDTH ? "" : "none";
  }

  /** 恢复默认面板宽度。 */
  private resetPanelWidth(): void {
    const viewportMaximum = Math.max(240, Math.min(MAX_PANEL_WIDTH, window.innerWidth - 24));
    const viewportMinimum = Math.min(MIN_PANEL_WIDTH, viewportMaximum);
    const width = Math.max(viewportMinimum, Math.min(viewportMaximum, DEFAULT_PANEL_WIDTH));
    this.panel.style.width = `${width}px`;
    this.updateResetButtonVisibility();
    chrome.storage.local.remove(PANEL_WIDTH_STORAGE_KEY);
  }

  // ---- Static: Panel width persistence ----

  /** 从 storage 加载已保存的面板宽度。 */
  static async loadPanelWidth(): Promise<number> {
    try {
      const result = await chrome.storage.local.get(PANEL_WIDTH_STORAGE_KEY);
      const width = Number(result[PANEL_WIDTH_STORAGE_KEY]);
      return Number.isFinite(width) && width >= 240 && width <= MAX_PANEL_WIDTH
        ? width
        : DEFAULT_PANEL_WIDTH;
    } catch {
      return DEFAULT_PANEL_WIDTH;
    }
  }

  /** 持久化面板宽度到 storage。 */
  static async savePanelWidth(width: number): Promise<void> {
    try {
      await chrome.storage.local.set({ [PANEL_WIDTH_STORAGE_KEY]: width });
    } catch {
      // 静默忽略写入失败
    }
  }

  /** 初始化面板宽度：加载已保存的值并应用。 */
  async initPanelWidth(): Promise<void> {
    const savedWidth = await Panel.loadPanelWidth();
    const viewportMaximum = Math.max(240, Math.min(MAX_PANEL_WIDTH, window.innerWidth - 24));
    const viewportMinimum = Math.min(MIN_PANEL_WIDTH, viewportMaximum);
    const width = Math.max(viewportMinimum, Math.min(viewportMaximum, savedWidth));
    this.panel.style.width = `${width}px`;
    this.updateResetButtonVisibility();
  }

  // ---- Timer ----

  private startElapsedTimer(): void {
    this.startTime = Date.now();
    this.stopElapsedTimer();
    this.elapsedEl.textContent = t("elapsedSeconds", "0");
    this.elapsedTimer = setInterval(() => {
      const secs = Math.floor((Date.now() - this.startTime) / 1000);
      this.elapsedEl.textContent = t("elapsedSeconds", String(secs));
    }, 1000);
  }

  private stopElapsedTimer(): void {
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }

  // ---- Helpers ----

  private hideAll(): void {
    this.loadingEl.style.display = "none";
    this.contentEl.style.display = "none";
    this.errorEl.style.display = "none";
    this.warningEl.style.display = "none";
    this.copyBtn.style.display = "none";
    this.summaryTranslateBtn.style.display = "none";
    this.timestampToggle.style.display = "none";
    this.transcriptTools.style.display = "none";
    this.hideCacheHint();
  }
}
