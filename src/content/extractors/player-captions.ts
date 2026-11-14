/** Bounded bridge to the document_start MAIN-world caption loader. */
import { t } from "../../utils/i18n";
import { UserError } from "../../utils/errors";

export interface PlayerCaptionBody {
  url: string;
  text: string;
}

/** CAPTION_LOAD_BUDGET_MS in caption-main.ts plus a margin for event delivery. */
export const PLAYER_CAPTION_BRIDGE_TIMEOUT_MS = 18_000;

const FAILURE_MESSAGES: Record<string, string> = {
  "no-captions": "errorNoCaptions",
  "not-ready": "errorCaptionPlayerNotReady",
  timeout: "errorCaptionLoadTimeout",
  "user-changed-captions": "errorCaptionChangedDuringLoad",
};

const activeLoads = new Map<string, { videoId: string; cancel: () => void }>();

export interface CaptionAvailableNotice {
  videoId: string;
  lang: string;
  kind: string;
}

/** Subscribe to body-free notices that the player fetched usable captions. */
export function onCaptionAvailable(listener: (notice: CaptionAvailableNotice) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (typeof detail?.videoId !== "string" || !detail.videoId || detail.videoId.length > 100) return;
    listener({
      videoId: detail.videoId,
      lang: typeof detail.lang === "string" ? detail.lang : "",
      kind: typeof detail.kind === "string" ? detail.kind : "",
    });
  };
  document.addEventListener("vas-caption-available", handler);
  return () => document.removeEventListener("vas-caption-available", handler);
}

/** Clear only this video's source captions, including obsolete in-flight loads. */
export function clearPlayerCaptionCache(videoId: string): void {
  for (const load of activeLoads.values()) {
    if (load.videoId === videoId) load.cancel();
  }
  document.dispatchEvent(new CustomEvent("vas-player-caption-clear", { detail: { videoId } }));
}

export function loadPlayerCaptions(
  videoId: string,
  preferredCaptionLanguage = "en",
): Promise<PlayerCaptionBody> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    let settled = false;
    const abort = () => finish(new DOMException("Navigation changed", "AbortError"));
    const finish = (error?: Error, body?: PlayerCaptionBody) => {
      if (settled) return;
      settled = true;
      activeLoads.delete(requestId);
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
        if (result.error === "navigation") {
          finish(new DOMException("Navigation changed", "AbortError"));
          return;
        }
        const reason = String(result.error);
        console.debug("[vas] Player caption load failed:", reason);
        // Distinct reasons instead of one "turn on CC manually" message, so
        // failures are diagnosable and users are not sent to the wrong fix.
        finish(new UserError(
          t(FAILURE_MESSAGES[reason] ?? "errorYoutubeCaptionUnavailable"),
          "YT_PLAYER_CAPTIONS",
          reason,
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
      t("errorCaptionLoadTimeout"), "YT_PLAYER_TIMEOUT",
    )), PLAYER_CAPTION_BRIDGE_TIMEOUT_MS);
    const navigationCheck = setInterval(() => {
      if (new URL(window.location.href).searchParams.get("v") !== videoId) abort();
    }, 200);
    activeLoads.set(requestId, { videoId, cancel: abort });
    document.addEventListener("vas-player-caption-result", onResult);
    document.addEventListener("yt-navigate-start", abort);
    window.addEventListener("pagehide", abort);
    document.dispatchEvent(new CustomEvent("vas-player-caption-request", {
      detail: { requestId, videoId, preferredCaptionLanguage },
    }));
  });
}
