import styles from "./player-onboarding.css?inline";
import { t } from "../../utils/i18n";
import { openAISetup } from "../../service/onboarding";

interface OnboardingTargets {
  getPlayer: () => HTMLElement | null;
  getSummaryButton: () => HTMLButtonElement | null;
  getPanelToolbar: () => HTMLElement | null;
  getSubtitleButton: () => HTMLButtonElement | null;
  setSummaryVisible: (visible: boolean) => void;
  openPanel: () => void;
  hasApiKey: () => boolean;
  isDark: () => boolean;
}

/** A non-modal tour: it reveals the real controls without starting AI requests. */
export class PlayerOnboarding {
  private host: HTMLDivElement | null = null;
  private card: HTMLElement | null = null;
  private ring: HTMLElement | null = null;
  private player: HTMLElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking = false;
  private generation = 0;
  private step = 0;
  private previousFocus: HTMLElement | null = null;
  private readonly reposition = () => this.position();
  private summaryButton: HTMLButtonElement | null = null;
  private readonly onSummaryOpen = () => {
    if (this.step === 0 && this.card) { this.step = 1; this.render(); }
  };

  constructor(private readonly targets: OnboardingTargets) {}

  start(replay = false): void {
    this.destroy();
    const generation = this.generation;
    // Wait for a visible video and both controls. Background tabs and YouTube's
    // temporary skeleton must not consume the one-time discovery opportunity.
    this.timer = setInterval(() => void this.tryStart(generation, replay), 500);
  }

  private async tryStart(generation: number, replay: boolean): Promise<void> {
    if (this.checking || generation !== this.generation || document.visibilityState !== "visible") return;
    const player = this.targets.getPlayer();
    const summary = this.targets.getSummaryButton();
    const subtitle = this.targets.getSubtitleButton();
    if (!player?.isConnected || !summary?.isConnected || !subtitle?.isConnected) return;
    const bounds = player.getBoundingClientRect();
    if (!bounds.width || !bounds.height || bounds.bottom <= 0 || bounds.top >= innerHeight || bounds.right <= 0 || bounds.left >= innerWidth) return;
    this.checking = true;
    try {
      const claimed = replay || (await chrome.runtime.sendMessage({ type: "CLAIM_PLAYER_ONBOARDING" }))?.show === true;
      if (generation !== this.generation) return;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      if (!claimed) return;
      this.player = player;
      this.summaryButton = summary;
      summary.addEventListener("click", this.onSummaryOpen);
      this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.host = document.createElement("div");
      this.host.id = "vas-player-onboarding";
      this.host.classList.toggle("vas-theme-light", !this.targets.isDark());
      Object.assign(this.host.style, { position: "fixed", inset: "0", zIndex: "2147483647", pointerEvents: "none" });
      const shadow = this.host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = styles;
      this.ring = document.createElement("div");
      this.ring.className = "ring";
      this.ring.setAttribute("aria-hidden", "true");
      this.card = document.createElement("section");
      this.card.className = "card";
      this.card.setAttribute("role", "dialog");
      this.card.setAttribute("aria-label", t("onboardingLabel"));
      this.card.addEventListener("keydown", (event) => {
        if (event.key === "Escape") { event.stopPropagation(); this.destroy(); }
      });
      // Only reveal YouTube's control bar while describing its subtitle button.
      const playerStyle = document.createElement("style");
      playerStyle.textContent = ".vas-onboarding-controls .ytp-chrome-bottom { opacity: 1 !important; } .vas-onboarding-controls .vas-player-translation-toggle { opacity: 1 !important; }";
      this.host.append(playerStyle);
      shadow.append(style, this.ring, this.card);
      (document.fullscreenElement ?? document.body).append(this.host);
      window.addEventListener("resize", this.reposition);
      window.addEventListener("scroll", this.reposition, true);
      document.addEventListener("fullscreenchange", this.reposition);
      this.targets.setSummaryVisible(true);
      this.step = 0;
      this.render();
    } catch (error) {
      console.debug("[vas] Player onboarding unavailable:", error);
      // Retry on the next video instead of repeatedly messaging a dead runtime.
      if (generation === this.generation) {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
      }
    } finally {
      this.checking = false;
    }
  }

  refreshLocalizedText(): void {
    if (this.card) {
      this.card.setAttribute("aria-label", t("onboardingLabel"));
      this.render(document.activeElement === this.host);
    }
  }

  setTheme(isDark: boolean): void {
    this.host?.classList.toggle("vas-theme-light", !isDark);
  }

  private render(focus = true): void {
    if (!this.card) return;
    this.player?.classList.toggle("vas-onboarding-controls", this.step === 1);
    this.card.replaceChildren();
    const top = document.createElement("div");
    top.className = "top";
    const progress = document.createElement("div");
    progress.className = "progress";
    progress.setAttribute("aria-label", t("onboardingStep", [String(this.step + 1), "3"]));
    for (let index = 0; index < 3; index++) {
      const dot = document.createElement("span");
      dot.className = `dot${index === this.step ? " active" : ""}`;
      progress.append(dot);
    }
    top.append(progress, this.button("onboardingSkip", "skip", () => this.destroy()));
    const title = document.createElement("h2");
    title.textContent = t(["onboardingSummaryTitle", "onboardingSubtitleTitle", "onboardingKeyTitle"][this.step]);
    const description = document.createElement("p");
    description.textContent = t(["onboardingSummaryBody", "onboardingSubtitleBody", "apiKeyExplanation"][this.step]);
    this.card.append(top, title, description);
    if (this.step === 0) {
      this.card.append(this.button("onboardingOpenPanel", "preview", () => {
        this.targets.openPanel();
        this.step = 1;
        this.render();
      }));
    }
    if (this.step === 2) {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = t(this.targets.hasApiKey() ? "onboardingKeyReady" : "apiKeyMembershipHint");
      this.card.append(hint);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    if (this.step > 0) actions.append(this.button("onboardingBack", "secondary", () => { this.step--; this.render(); }));
    if (this.step === 2 && !this.targets.hasApiKey()) {
      actions.append(this.button("onboardingLater", "secondary", () => this.destroy()));
    }
    const finalStep = this.step === 2;
    actions.append(this.button(finalStep ? (this.targets.hasApiKey() ? "onboardingDone" : "onboardingSetup") : "onboardingNext", "primary", () => {
      if (!finalStep) { this.step++; this.render(); return; }
      if (!this.targets.hasApiKey()) {
        const button = actions.querySelector<HTMLButtonElement>(".primary")!;
        button.disabled = true;
        void openAISetup().then(() => this.destroy()).catch(() => {
          button.disabled = false;
          description.textContent = t("onboardingSetupFallback");
        });
      } else this.destroy();
    }));
    this.card.append(actions);
    this.position();
    if (focus) this.card.querySelector<HTMLButtonElement>(".primary")?.focus({ preventScroll: true });
  }

  private button(key: string, className: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = t(key);
    button.addEventListener("click", onClick);
    return button;
  }

  private position(): void {
    if (!this.card || !this.host || !this.ring) return;
    const parent = document.fullscreenElement ?? document.body;
    if (this.host.parentElement !== parent) parent.append(this.host);
    let anchor: HTMLElement | null = this.step === 0 ? this.targets.getSummaryButton() : this.step === 1 ? this.targets.getSubtitleButton() : null;
    if (this.step === 0 && !anchor?.getBoundingClientRect().width) anchor = this.targets.getPanelToolbar();
    const rect = anchor?.getBoundingClientRect();
    const visible = rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    this.ring.hidden = !visible;
    if (visible) {
      Object.assign(this.ring.style, { left: `${rect.left - 5}px`, top: `${rect.top - 5}px`, width: `${rect.width + 10}px`, height: `${rect.height + 10}px` });
    }
    const width = this.card.offsetWidth;
    const height = this.card.offsetHeight;
    const left = visible ? rect.right - width : innerWidth - width - 24;
    const top = visible ? (rect.bottom + height + 24 < innerHeight ? rect.bottom + 16 : rect.top - height - 16) : 100;
    this.card.style.left = `${Math.max(12, Math.min(left, innerWidth - width - 12))}px`;
    this.card.style.top = `${Math.max(12, Math.min(top, innerHeight - height - 12))}px`;
  }

  destroy(): void {
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Restore focus only if the tour still owns it; do not interrupt a user
    // who has moved into the real panel or another YouTube control.
    const ownsFocus = this.host && document.activeElement === this.host;
    this.host?.remove();
    this.summaryButton?.removeEventListener("click", this.onSummaryOpen);
    this.summaryButton = null;
    this.host = null;
    this.card = null;
    this.ring = null;
    this.player?.classList.remove("vas-onboarding-controls");
    this.player = null;
    this.targets.setSummaryVisible(false);
    window.removeEventListener("resize", this.reposition);
    window.removeEventListener("scroll", this.reposition, true);
    document.removeEventListener("fullscreenchange", this.reposition);
    if (ownsFocus && this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
    this.previousFocus = null;
  }
}
