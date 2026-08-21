import { describe, expect, it } from "vitest";
import { resolveBilingualEnabled } from "./bilingual-preference";

describe("bilingual subtitle default preference", () => {
  it("uses the synced default for a new video", () => {
    expect(resolveBilingualEnabled(true, undefined)).toBe(true);
    expect(resolveBilingualEnabled(false, undefined)).toBe(false);
  });

  it("keeps an explicit per-video choice over the default", () => {
    expect(resolveBilingualEnabled(true, false)).toBe(false);
    expect(resolveBilingualEnabled(false, true)).toBe(true);
  });
});
