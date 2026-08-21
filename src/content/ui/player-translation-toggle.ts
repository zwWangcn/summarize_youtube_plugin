import { t } from "../../utils/i18n";
import { translationToggleIconMarkup } from "./icons";

/** A YouTube-control-bar button that owns only the current video's translation state. */
export class PlayerTranslationToggle {
  private button: HTMLButtonElement | null = null;
  private player: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private enabled = true;
  private available = true;

  constructor(private readonly onChange: (enabled: boolean) => void) {}

  mount(player: HTMLElement): void {
    if (this.player !== player) {
      this.observer?.disconnect();
      this.player = player;
      this.observer = new MutationObserver(() => this.ensureButton());
      this.observer.observe(player, { childList: true, subtree: true });
    }
    this.ensureButton();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.updateButton();
  }

  setAvailable(available: boolean): void {
    this.available = available;
    this.updateButton();
  }

  refreshLocalizedText(): void {
    this.updateButton();
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.button?.remove();
    this.button = null;
    this.player = null;
  }

  private ensureButton(): void {
    if (!this.player?.isConnected) return;
    const existing = this.player.querySelector<HTMLButtonElement>(".vas-player-translation-toggle");
    if (existing) {
      this.button = existing;
      const subtitles = this.player.querySelector<HTMLElement>(".ytp-subtitles-button");
      if (subtitles && subtitles.nextElementSibling !== existing) {
        subtitles.insertAdjacentElement("afterend", existing);
      }
      this.updateButton();
      return;
    }

    const subtitles = this.player.querySelector<HTMLElement>(".ytp-subtitles-button");
    const controls = subtitles?.parentElement ?? this.player.querySelector<HTMLElement>(".ytp-right-controls");
    if (!controls) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "ytp-button vas-player-translation-toggle";
    button.addEventListener("click", () => {
      if (this.available) this.onChange(!this.enabled);
    });
    if (subtitles) subtitles.insertAdjacentElement("afterend", button);
    else controls.prepend(button);
    this.button = button;
    this.updateButton();
  }

  private updateButton(): void {
    if (!this.button) return;
    this.button.disabled = !this.available;
    this.button.setAttribute("aria-disabled", String(!this.available));
    this.button.setAttribute("aria-pressed", String(this.enabled));
    const label = this.available
      ? t(this.enabled ? "disableBilingualSubtitles" : "enableBilingualSubtitles")
      : t("bilingualSetupRequired");
    this.button.setAttribute("aria-label", label);
    this.button.title = label;
    if (this.available) {
      if (this.button.style.opacity) this.button.style.opacity = "";
      if (this.button.style.cursor) this.button.style.cursor = "";
    } else {
      this.button.style.opacity = "0.45";
      this.button.style.cursor = "not-allowed";
    }
    const variant = this.available && this.enabled ? "translation-on" : "translation-off";
    if (!this.button.innerHTML.includes(`data-icon-variant="${variant}"`)) {
      this.button.innerHTML = `<div class="ytp-subtitles-button-icon vas-player-translation-toggle-icon">${translationToggleIconMarkup(24, "", variant)}</div>`;
    }
  }
}
