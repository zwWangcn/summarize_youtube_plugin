import {
  AIServiceError,
  ContentFilteredError,
  NoApiKeyError,
} from "../service/ai";
import { TranslationFormatError } from "../service/transcript-translation";
import { UserError } from "../utils/errors";

export interface ErrorPresenter {
  showError(message: string): void;
}

/**
 * 将已经捕获的业务异常转换为面板提示。
 *
 * Chrome 会把 content script 的 error/warning 记录为扩展错误，因此
 * 已经被 UI 消费的异常只使用 debug 级别保留诊断信息。
 */
export function handleError(err: unknown, panel: ErrorPresenter): void {
  if (err instanceof UserError) {
    panel.showError(err.message);
    console.debug(`[vas] ${err.code}:`, err.detail ?? err.message);
  } else if (
    err instanceof AIServiceError ||
    err instanceof ContentFilteredError ||
    err instanceof NoApiKeyError ||
    err instanceof TranslationFormatError
  ) {
    panel.showError(err.message);
    console.debug("[vas] AI error:", err.message);
  } else {
    panel.showError("出了点问题，请稍后重试");
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.debug("[vas] Unexpected error:", detail);
  }
}
