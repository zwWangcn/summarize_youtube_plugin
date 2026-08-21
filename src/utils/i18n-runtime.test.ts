import { afterEach, describe, expect, it, vi } from "vitest";

interface DeferredResponse {
  promise: Promise<Response>;
  resolve: (catalog: Record<string, { message: string }>) => void;
}

function deferredResponse(): DeferredResponse {
  let resolvePromise!: (response: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (catalog) => resolvePromise({
      ok: true,
      json: async () => catalog,
    } as Response),
  };
}

describe("runtime UI language activation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps the newest language when catalog requests finish out of order", async () => {
    const english = deferredResponse();
    const simplifiedChinese = deferredResponse();
    const japanese = deferredResponse();
    const requests = new Map<string, DeferredResponse>([
      ["en", english],
      ["zh_CN", simplifiedChinese],
      ["ja", japanese],
    ]);

    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
      },
      i18n: {
        getMessage: () => "",
      },
    });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const locale = /_locales\/([^/]+)\/messages\.json/u.exec(url)?.[1];
      const request = locale ? requests.get(locale) : undefined;
      if (!request) throw new Error(`Unexpected catalog URL: ${url}`);
      return request.promise;
    }));

    const { activateUiLanguage, t } = await import("./i18n");
    const firstActivation = activateUiLanguage("zh-CN");
    const secondActivation = activateUiLanguage("ja");

    english.resolve({ greeting: { message: "Hello" } });
    japanese.resolve({ greeting: { message: "こんにちは" } });
    await expect(secondActivation).resolves.toBe(true);
    expect(t("greeting")).toBe("こんにちは");

    simplifiedChinese.resolve({ greeting: { message: "你好" } });
    await expect(firstActivation).resolves.toBe(false);
    expect(t("greeting")).toBe("こんにちは");
  });
});
