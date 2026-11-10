import { afterEach, describe, expect, it, vi } from "vitest";

describe("bundled runtime UI languages", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it("loads each fixed UI language without cross-origin fetches or runtime.getURL", async () => {
    const fetch = vi.fn(() => { throw new Error("Cross-origin resource fetch blocked"); });
    const getURL = vi.fn(() => { throw new Error("Extension resource URL unavailable"); });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("chrome", { runtime: { getURL }, i18n: { getMessage: () => "" } });
    const { activateUiLanguage, t } = await import("./i18n");
    for (const locale of ["en", "zh-CN", "zh-TW", "ja", "ko"] as const) {
      expect(await activateUiLanguage(locale)).toBe(true);
      expect(t("extensionName")).not.toBe("extensionName");
      expect(t("errorTranslationValidation")).not.toBe("errorTranslationValidation");
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(getURL).not.toHaveBeenCalled();
  });

  it("keeps the newest language when activations overlap", async () => {
    vi.stubGlobal("chrome", { i18n: { getMessage: () => "" } });
    const { activateUiLanguage, t } = await import("./i18n");
    const first = activateUiLanguage("zh-CN");
    const last = activateUiLanguage("ja");
    expect(await first).toBe(false);
    expect(await last).toBe(true);
    expect(t("testBuild")).toBe("テスト版");
  });
});
