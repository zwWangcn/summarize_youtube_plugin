import { afterEach, describe, expect, it, vi } from "vitest";
import { AIServiceError } from "../service/ai";
import { handleError, type ErrorPresenter } from "./error-handler";

describe("handleError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a friendly message and does not emit a Chrome extension error", () => {
    const showError = vi.fn();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("storage unavailable");

    handleError(cause, { showError } satisfies ErrorPresenter);

    expect(showError).toHaveBeenCalledWith("出了点问题，请稍后重试");
    expect(debug).toHaveBeenCalledWith("[vas] Unexpected error:", cause.stack);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("preserves known AI error messages at warning level", () => {
    const showError = vi.fn();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new AIServiceError("AI 服务暂时不可用");

    handleError(cause, { showError } satisfies ErrorPresenter);

    expect(showError).toHaveBeenCalledWith("AI 服务暂时不可用");
    expect(debug).toHaveBeenCalledWith("[vas] AI error:", cause.message);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
