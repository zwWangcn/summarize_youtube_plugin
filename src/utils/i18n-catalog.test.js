import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const localeCodes = ["en", "zh_CN", "zh_TW", "ja", "ko"];
const readJson = (url) => JSON.parse(readFileSync(url, "utf8"));

describe("Chrome UI locale catalogs", () => {
  it("keeps all five catalogs aligned with the English fallback", () => {
    const fallback = readJson(new URL("../../_locales/en/messages.json", import.meta.url));
    const fallbackKeys = Object.keys(fallback).sort();

    for (const locale of localeCodes) {
      const catalog = readJson(
        new URL(`../../_locales/${locale}/messages.json`, import.meta.url),
      );
      expect(Object.keys(catalog).sort()).toEqual(fallbackKeys);
      for (const key of fallbackKeys) {
        expect(catalog[key].message).not.toBe("");
        expect(catalog[key].placeholders ?? {}).toEqual(fallback[key].placeholders ?? {});
      }
    }
  });

  it("uses English as the manifest fallback locale", () => {
    const manifest = readJson(new URL("../manifest.json", import.meta.url));
    expect(manifest.default_locale).toBe("en");
  });
});
