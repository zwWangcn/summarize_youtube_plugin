import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("stream keep-alive", () => {
  const getPlatformInfo = vi.fn(async () => ({}));
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    getPlatformInfo.mockClear();
    vi.stubGlobal("chrome", { runtime: { getPlatformInfo } });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("pings an extension API under the 30 s idle limit only while streams are active", async () => {
    const { beginStreamKeepAlive } = await import("./stream-keepalive");
    const endFirst = beginStreamKeepAlive();
    const endSecond = beginStreamKeepAlive();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(getPlatformInfo).toHaveBeenCalledTimes(1);
    endFirst();
    endFirst(); // idempotent: must not end the second stream's keep-alive
    await vi.advanceTimersByTimeAsync(20_000);
    expect(getPlatformInfo).toHaveBeenCalledTimes(2);
    endSecond();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getPlatformInfo).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
