import { beforeEach, describe, expect, it, vi } from "vitest";

type Store = Record<string, unknown>;

function createStorageArea(store: Store) {
  return {
    get: vi.fn(async (query?: string | string[] | Record<string, unknown> | null) => {
      if (query == null) return { ...store };
      if (typeof query === "string") return { [query]: store[query] };
      if (Array.isArray(query)) {
        return Object.fromEntries(query.map((key) => [key, store[key]]));
      }
      const result: Store = {};
      for (const [key, fallback] of Object.entries(query)) {
        result[key] = Object.prototype.hasOwnProperty.call(store, key)
          ? store[key]
          : fallback;
      }
      return result;
    }),
    set: vi.fn(async (value: Store) => Object.assign(store, value)),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
    }),
  };
}

describe("settings and API key storage", () => {
  let syncStore: Store;
  let localStore: Store;
  let uiLanguage: string;

  beforeEach(() => {
    vi.resetModules();
    syncStore = { "vas-settings-migrated-v2": true };
    localStore = { "vas-api-keys-migrated-v3": true };
    uiLanguage = "ja-JP";
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        i18n: {
          getUILanguage: vi.fn(() => uiLanguage),
          getMessage: vi.fn((key: string) => key),
        },
        storage: {
          sync: createStorageArea(syncStore),
          local: createStorageArea(localStore),
        },
      },
    });
  });

  it("initializes and persists the output language from the Chrome UI locale", async () => {
    const { getSettings } = await import("./storage");
    expect((await getSettings()).outputLanguage).toBe("ja");
    expect(syncStore.outputLanguage).toBe("ja");
  });

  it("does not replace an initialized output language when the UI locale changes", async () => {
    syncStore.outputLanguage = "fr";
    uiLanguage = "de-DE";
    const { getSettings } = await import("./storage");
    expect((await getSettings()).outputLanguage).toBe("fr");
    expect(syncStore.outputLanguage).toBe("fr");
  });

  it("reads back an output language saved through the settings API", async () => {
    const { getSettings, setSettings } = await import("./storage");
    await getSettings();
    await setSettings({ outputLanguage: "de" });
    expect((await getSettings()).outputLanguage).toBe("de");
    expect(syncStore.outputLanguage).toBe("de");
  });

  it("migrates legacy synced API keys to local storage and removes the synced copy", async () => {
    syncStore.apiKeys = { deepseek: " synced-key " };
    localStore = { apiKeys: { openai: "local-key" } };
    (chrome.storage as unknown as { local: ReturnType<typeof createStorageArea> }).local =
      createStorageArea(localStore);

    const { getApiKeys } = await import("./storage");
    await expect(getApiKeys()).resolves.toEqual({
      deepseek: "synced-key",
      openai: "local-key",
    });
    expect(syncStore.apiKeys).toBeUndefined();
    expect(localStore["vas-api-keys-migrated-v3"]).toBe(true);
  });

  it("moves the v1 DeepSeek key directly to local storage", async () => {
    syncStore = { deepseekApiKey: " legacy-key " };
    localStore = {};
    (chrome.storage as unknown as {
      sync: ReturnType<typeof createStorageArea>;
      local: ReturnType<typeof createStorageArea>;
    }).sync = createStorageArea(syncStore);
    (chrome.storage as unknown as { local: ReturnType<typeof createStorageArea> }).local =
      createStorageArea(localStore);

    const { getApiKey } = await import("./storage");
    await expect(getApiKey("deepseek")).resolves.toBe("legacy-key");
    expect(syncStore.deepseekApiKey).toBeUndefined();
    expect(syncStore.apiKeys).toBeUndefined();
    expect(localStore.apiKeys).toEqual({ deepseek: "legacy-key" });
  });

  it("stores keys locally by default", async () => {
    const { getApiKey, setApiKey } = await import("./storage");
    await setApiKey("openai", " sk-test ");
    await expect(getApiKey("openai")).resolves.toBe("sk-test");
    expect(localStore.apiKeys).toEqual({ openai: "sk-test" });
  });

  it("clears locally stored keys", async () => {
    localStore.apiKeys = { openai: "local-key" };
    const { clearAllApiKeys } = await import("./storage");
    await clearAllApiKeys();
    expect(localStore.apiKeys).toBeUndefined();
  });

});
