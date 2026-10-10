import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimPlayerOnboarding, ONBOARDING_SEEN_KEY, openAISetup } from "./onboarding";

describe("first-use player tour", () => {
  let stored: Record<string, unknown>;
  beforeEach(() => {
    stored = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
          set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(stored, values); }),
        },
      },
      runtime: { sendMessage: vi.fn(async () => ({ opened: true })) },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows once across concurrent video tabs and subsequent visits", async () => {
    expect(await Promise.all([claimPlayerOnboarding(), claimPlayerOnboarding(), claimPlayerOnboarding()]))
      .toEqual([true, false, false]);
    expect(await claimPlayerOnboarding()).toBe(false);
    expect(stored).toEqual({ [ONBOARDING_SEEN_KEY]: true });
  });

  it("recovers after storage failure without incorrectly consuming the tour", async () => {
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(claimPlayerOnboarding()).rejects.toThrow("Storage unavailable");
    expect(await claimPlayerOnboarding()).toBe(true);
  });

  it("reports failed settings navigation instead of silently dismissing the tour", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ opened: false });
    await expect(openAISetup()).rejects.toThrow("Could not open AI settings");
    await expect(openAISetup()).resolves.toBeUndefined();
  });
});
