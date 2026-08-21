import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerTranslationToggle } from "./player-translation-toggle";

class FakeElement {
  className = "";
  type = "";
  title = "";
  innerHTML = "";
  isConnected = true;
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  readonly style: Record<string, string> = { cssText: "" };
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Array<() => void>>();

  get nextElementSibling(): FakeElement | null {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] ?? null;
  }

  append(...elements: FakeElement[]): void {
    for (const element of elements) this.attachAt(element, this.children.length);
  }

  prepend(element: FakeElement): void {
    this.attachAt(element, 0);
  }

  insertAdjacentElement(position: InsertPosition, element: FakeElement): FakeElement {
    if (position !== "afterend" || !this.parentElement) throw new Error("Unsupported insertion");
    const index = this.parentElement.children.indexOf(this);
    this.parentElement.attachAt(element, index + 1);
    return element;
  }

  querySelector<T>(selector: string): T | null {
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    for (const child of this.children) {
      if (child.className.split(/\s+/).includes(className)) return child as T;
      const nested = child.querySelector<T>(selector);
      if (nested) return nested;
    }
    return null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener();
  }

  remove(): void {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  private attachAt(element: FakeElement, index: number): void {
    element.remove();
    element.parentElement = this;
    this.children.splice(index, 0, element);
  }
}

class FakeMutationObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(_callback: MutationCallback) {}
}

function createPlayer(): { player: FakeElement; controls: FakeElement; subtitles: FakeElement } {
  const player = new FakeElement();
  const controls = new FakeElement();
  controls.className = "ytp-right-controls";
  const subtitles = new FakeElement();
  subtitles.className = "ytp-subtitles-button ytp-button";
  controls.append(subtitles);
  player.append(controls);
  return { player, controls, subtitles };
}

describe("PlayerTranslationToggle", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      createElement: () => new FakeElement(),
    });
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    vi.stubGlobal("chrome", {
      i18n: {
        getMessage: (key: string) => ({
          disableBilingualSubtitles: "Disable bilingual subtitles",
          enableBilingualSubtitles: "Enable bilingual subtitles",
        })[key] ?? key,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts once immediately after the native subtitles button", () => {
    const { player, controls, subtitles } = createPlayer();
    const onChange = vi.fn();
    const toggle = new PlayerTranslationToggle(onChange);

    toggle.mount(player as unknown as HTMLElement);
    toggle.mount(player as unknown as HTMLElement);

    expect(controls.children).toHaveLength(2);
    const button = controls.children[1];
    expect(controls.children[0]).toBe(subtitles);
    expect(button.className).toBe("ytp-button vas-player-translation-toggle");
    expect(button.style.cssText).toBe("");
    expect(button.innerHTML).toContain("ytp-subtitles-button-icon");
    expect(button.innerHTML).toContain('viewBox="0 0 24 24"');
    expect(button.innerHTML).toContain('stroke="currentColor"');
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("Disable bilingual subtitles");

    button.click();
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("updates accessible state and restores adjacency after controls rebuild", () => {
    const { player, controls, subtitles } = createPlayer();
    const toggle = new PlayerTranslationToggle(vi.fn());
    toggle.mount(player as unknown as HTMLElement);
    toggle.setEnabled(false);

    const button = controls.children[1];
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe("Enable bilingual subtitles");
    expect(button.title).toBe("Enable bilingual subtitles");
    expect(button.style).not.toHaveProperty("opacity");

    const replacementControl = new FakeElement();
    subtitles.insertAdjacentElement("afterend", replacementControl);
    toggle.mount(player as unknown as HTMLElement);
    expect(controls.children).toEqual([subtitles, button, replacementControl]);

    toggle.destroy();
    expect(controls.children).toEqual([subtitles, replacementControl]);
  });
});
