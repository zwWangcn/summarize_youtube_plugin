import { afterEach, describe, expect, it, vi } from "vitest";
import { runSummaryCacheOperation } from "./summary-cache-operation";

describe("runSummaryCacheOperation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the cache result without reporting a failure", async () => {
    const onFailure = vi.fn();

    await expect(runSummaryCacheOperation("read", async () => "cached", onFailure))
      .resolves.toBe("cached");
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("consumes storage rejection and reports a non-blocking failure", async () => {
    const cause = new Error("storage unavailable");
    const onFailure = vi.fn();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(runSummaryCacheOperation("write", async () => {
      throw cause;
    }, onFailure)).resolves.toBeUndefined();

    expect(onFailure).toHaveBeenCalledWith(cause);
    expect(debug).toHaveBeenCalledWith("[vas] Summary cache write failed:", cause.stack);
    expect(warn).not.toHaveBeenCalled();
  });
});
