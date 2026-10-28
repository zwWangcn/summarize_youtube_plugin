/** Bounded bridge to the document_start MAIN-world caption loader. */
import { t } from "../../utils/i18n";
import { UserError } from "../../utils/errors";

export interface PlayerCaptionBody {
  url: string;
  text: string;
}

export function loadPlayerCaptions(
  videoId: string,
  preferredLanguages: readonly string[],
): Promise<PlayerCaptionBody> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    let settled = false;
    const abort = () => finish(new DOMException("Navigation changed", "AbortError"));
    const finish = (error?: Error, body?: PlayerCaptionBody) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(navigationCheck);
      document.removeEventListener("vas-player-caption-result", onResult);
      document.removeEventListener("yt-navigate-start", abort);
      window.removeEventListener("pagehide", abort);
      // Also releases the player if this context times out before MAIN replies.
      document.dispatchEvent(new CustomEvent("vas-player-caption-cancel", {
        detail: { requestId },
      }));
      if (error) reject(error);
      else resolve(body!);
    };
    const onResult = (event: Event) => {
      const result = (event as CustomEvent).detail;
      if (result?.requestId !== requestId || result.videoId !== videoId) return;
      if (new URL(window.location.href).searchParams.get("v") !== videoId) return abort();
      if (result.error) {
        if (result.error === "rate-limited") {
          const seconds = typeof result.retryAfterSeconds === "number" && Number.isFinite(result.retryAfterSeconds)
            ? Math.max(1, Math.ceil(result.retryAfterSeconds)) : 60;
          finish(new UserError(t("errorYoutubeRateLimited", String(seconds)), "YT_RATE_LIMITED", "HTTP 429"));
          return;
        }
        finish(result.error === "navigation"
          ? new DOMException("Navigation changed", "AbortError")
          : new UserError(
            t(result.error === "no-captions" ? "errorNoCaptions" : "errorYoutubeCaptionUnavailable"),
            "YT_PLAYER_CAPTIONS",
            String(result.error),
          ));
      } else if (
        typeof result.url === "string" &&
        typeof result.text === "string" &&
        result.text.length > 0 && result.text.length <= 5_000_000
      ) {
        try {
          const url = new URL(result.url);
          if (
            url.protocol !== "https:" ||
            !(url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")) ||
            url.pathname !== "/api/timedtext" ||
            url.searchParams.get("v") !== videoId ||
            url.searchParams.has("tlang")
          ) return;
          finish(undefined, { url: result.url, text: result.text });
        } catch { /* Ignore malformed page messages until the bounded timeout. */ }
      }
    };
    const timeout = setTimeout(() => finish(new UserError(
      t("errorYoutubeCaptionUnavailable"), "YT_PLAYER_TIMEOUT",
    )), 16_000);
    const navigationCheck = setInterval(() => {
      if (new URL(window.location.href).searchParams.get("v") !== videoId) abort();
    }, 200);
    document.addEventListener("vas-player-caption-result", onResult);
    document.addEventListener("yt-navigate-start", abort);
    window.addEventListener("pagehide", abort);
    document.dispatchEvent(new CustomEvent("vas-player-caption-request", {
      detail: { requestId, videoId, preferredLanguages: [...preferredLanguages] },
    }));
  });
}
