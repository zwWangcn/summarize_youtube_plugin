import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings, setSettings } from "./storage";

describe("output language setting initialization", () => {
  let store: Record<string, unknown>;
  let uiLanguage: string;

  beforeEach(() => {
    store = { "vas-settings-migrated-v2": true };
    uiLanguage = "ja-JP";
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        i18n: {
          getUILanguage: vi.fn(() => uiLanguage),
          getMessage: vi.fn((key: string) => key),
        },
        storage: {
          sync: {
            get: vi.fn(async (query: string | Record<string, unknown>) => {
              if (typeof query === "string") return { [query]: store[query] };
              const result: Record<string, unknown> = {};
              for (const [key, fallback] of Object.entries(query)) {
                result[key] = Object.prototype.hasOwnProperty.call(store, key)
                  ? store[key]
                  : fallback;
              }
              return result;
            }),
            set: vi.fn(async (value: Record<string, unknown>) => Object.assign(store, value)),
            remove: vi.fn(async (key: string) => { delete store[key]; }),
          },
        },
      },
    });
  });

  it("initializes and persists the output language from the Chrome UI locale", async () => {
    expect((await getSettings()).outputLanguage).toBe("ja");
    expect(store.outputLanguage).toBe("ja");
  });

  it("does not replace an initialized output language when the UI locale changes", async () => {
    store.outputLanguage = "fr";
    uiLanguage = "de-DE";
    expect((await getSettings()).outputLanguage).toBe("fr");
    expect(store.outputLanguage).toBe("fr");
  });

  it("reads back an output language saved through the settings API", async () => {
    await getSettings();
    await setSettings({ outputLanguage: "de" });

    expect((await getSettings()).outputLanguage).toBe("de");
    expect(store.outputLanguage).toBe("de");
  });
});
