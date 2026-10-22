/**
 * 在 YouTube MAIN world、document_start 阶段安装字幕请求观察器。
 * 此文件必须保持自包含；捕获结果通过 DOM CustomEvent 交给隔离世界。
 */

const FLAG = "__vas_interceptor_installed";
const mainWindow = window as unknown as Record<string, unknown>;

interface PlayerTrack {
  languageCode?: string;
  kind?: string;
  [key: string]: unknown;
}

interface CaptionPlayer extends HTMLElement {
  getPlayerResponse(): {
    videoDetails?: { videoId?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: PlayerTrack[] } };
  };
  getOption(module: string, option: string): PlayerTrack | undefined;
  setOption(module: string, option: string, track: PlayerTrack): void;
  loadModule(module: string): void;
}

if (!mainWindow[FLAG]) {
  mainWindow[FLAG] = true;

  const recentCaptions = new Map<string, { url: string; text: string; timestamp: number }>();
  const captureListeners = new Set<(url: string, text: string) => void>();
  const captionUrl = (value: string): URL | null => {
    try {
      const url = new URL(value, location.href);
      return url.protocol === "https:" &&
        (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")) &&
        url.pathname === "/api/timedtext" && !url.searchParams.has("tlang")
        ? url : null;
    } catch { return null; }
  };
  const isTimedText = (url: string) => url.includes("/api/timedtext");
  const notify = (url: string, text: string) => {
    const parsed = captionUrl(url);
    if (!parsed || !text.trim() || text.length > 5_000_000) return;
    // An early request can return a nonempty JSON envelope without any cues.
    // Keep waiting for real captions instead of treating that as success.
    try {
      if (text.trimStart().startsWith("{")) {
        const data = JSON.parse(text);
        if (!Array.isArray(data.events) || !data.events.some((event: {
          segs?: { utf8?: string }[]; tStartMs?: number; dDurationMs?: number;
        }) => Number.isFinite(event.tStartMs) && Number.isFinite(event.dDurationMs) &&
          Array.isArray(event.segs) && event.segs.some((segment) =>
            typeof segment.utf8 === "string" && segment.utf8.trim()))) return;
      } else {
        const xml = new DOMParser().parseFromString(text, "text/xml");
        if (xml.querySelector("parsererror") || ![...xml.querySelectorAll("text")]
          .some((cue) => cue.textContent?.trim())) return;
      }
    } catch { return; }
    url = parsed.toString();
    const key = `${parsed.searchParams.get("v")}:${parsed.searchParams.get("lang")}:${parsed.searchParams.get("kind")}`;
    recentCaptions.delete(key);
    recentCaptions.set(key, { url, text, timestamp: Date.now() });
    while (recentCaptions.size > 12) recentCaptions.delete(recentCaptions.keys().next().value!);
    for (const listener of captureListeners) listener(url, text);
    document.dispatchEvent(new CustomEvent("vas-caption-captured", {
      detail: { url, text },
    }));
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    return originalFetch(input, init).then((response) => {
      if (response.ok && isTimedText(url)) {
        void response.clone().text().then((text) => notify(url, text)).catch(() => {});
      }
      return response;
    });
  }) as typeof window.fetch;

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    (this as unknown as Record<string, unknown>).__vas_url = url.toString();
    originalOpen.call(
      this,
      method,
      url,
      async as boolean,
      username as string | null,
      password as string | null,
    );
  };
  XMLHttpRequest.prototype.send = function (
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const url = (this as unknown as Record<string, unknown>).__vas_url as string | undefined;
    if (url && isTimedText(url)) {
      this.addEventListener("load", function () {
        try {
          if (this.status === 200 && typeof this.responseText === "string") {
            notify(url, this.responseText);
          }
        } catch {
          // responseText is unavailable for non-text responseType values.
        }
      }, { once: true });
    }
    originalSend.call(this, body);
  };

  // The isolated world cannot call movie_player methods. Keep this bridge
  // self-contained so the built MAIN-world entry remains a classic script.
  let active: { requestId: string; controller: AbortController } | null = null;
  const currentVideoId = () => new URL(location.href).searchParams.get("v");
  const wait = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Caption request cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });

  document.addEventListener("vas-player-caption-cancel", ((event: CustomEvent) => {
    if (event.detail?.requestId === active?.requestId) active?.controller.abort();
  }) as EventListener);

  document.addEventListener("vas-player-caption-request", ((event: CustomEvent) => {
    const request = event.detail;
    if (
      typeof request?.requestId !== "string" || request.requestId.length > 100 ||
      typeof request.videoId !== "string" || request.videoId !== currentVideoId() ||
      !Array.isArray(request.preferredLanguages)
    ) return;
    // The isolated extractor shares requests. Cancel obsolete probes before
    // starting another so two requests can never toggle the player together.
    const previous = active;
    previous?.controller.abort();
    const controller = new AbortController();
    active = { requestId: request.requestId, controller };
    const { signal } = controller;
    const assertCurrent = () => {
      if (signal.aborted || currentVideoId() !== request.videoId) {
        throw new DOMException("Navigation changed", "AbortError");
      }
    };
    const reply = (body: { url: string; text: string } | { error: string }) => {
      document.dispatchEvent(new CustomEvent("vas-player-caption-result", {
        detail: { requestId: request.requestId, videoId: request.videoId, ...body },
      }));
    };
    void (async () => {
      // Let the cancelled request's finally block restore its original state.
      await Promise.resolve();
      let restore: (() => void) | undefined;
      let navigationTimer: ReturnType<typeof setInterval> | undefined;
      let result: { url: string; text: string } | { error: string };
      try {
        assertCurrent();
        const deadline = Date.now() + 8_000;
        let player: CaptionPlayer | null = null;
        let tracks: PlayerTrack[] = [];
        let matchedPlayer = false;
        while (Date.now() < deadline) {
          assertCurrent();
          player = document.getElementById("movie_player") as CaptionPlayer | null;
          try {
            const response = player?.getPlayerResponse();
            matchedPlayer = response?.videoDetails?.videoId === request.videoId;
            tracks = matchedPlayer
              ? (response?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [])
                .filter((track) => typeof track.languageCode === "string" && track.languageCode)
              : [];
            if (tracks.length && typeof player?.getOption === "function" &&
              typeof player.setOption === "function" && typeof player.loadModule === "function") break;
          } catch { /* The player API can exist before its response is ready. */ }
          await wait(200, signal);
        }
        assertCurrent();
        if (!player || !tracks.length) throw new Error(matchedPlayer ? "no-captions" : "not-ready");
        const target = player;
        const preferred = request.preferredLanguages.slice(0, 16)
          .filter((language: unknown): language is string => typeof language === "string");
        const findTrack = (language: string) => tracks.find((track) => track.languageCode === language && track.kind !== "asr") ??
          tracks.find((track) => track.languageCode === language);
        const track = preferred.map(findTrack).find(Boolean) ?? tracks[0];
        const matches = (value: string) => {
          const url = captionUrl(value);
          return url !== null && url.searchParams.get("v") === request.videoId &&
            url.searchParams.get("lang") === track.languageCode &&
            (url.searchParams.get("kind") || "") === (track.kind || "");
        };
        // Retain responses that arrived before the isolated script registered.
        const cached = [...recentCaptions.values()].find((body) =>
          Date.now() - body.timestamp < 30_000 && matches(body.url));
        if (cached) {
          result = cached;
        } else {
          const original = { ...target.getOption("captions", "track") };
          let userChanged = false;
          let changed = false;
          const onClick = (event: Event) => {
            if ((event.target as Element | null)?.closest?.(".ytp-subtitles-button")) userChanged = true;
          };
          target.addEventListener("click", onClick, true);
          const style = document.createElement("style");
          style.textContent = "#movie_player.vas-caption-probe .ytp-caption-window-container{visibility:hidden!important}";
          target.appendChild(style);
          target.classList.add("vas-caption-probe");
          restore = () => {
            target.removeEventListener("click", onClick, true);
            style.remove();
            target.classList.remove("vas-caption-probe");
            try {
              // Never apply the old video's preference to a new SPA video or
              // override a caption choice the user made during this probe.
              if (!changed || userChanged || currentVideoId() !== request.videoId ||
                target.getPlayerResponse()?.videoDetails?.videoId !== request.videoId) return;
              const current = target.getOption("captions", "track");
              if (!current?.languageCode || (current.languageCode === track.languageCode &&
                (current.kind || "") === (track.kind || ""))) {
                target.setOption("captions", "track", original);
              }
            } catch { /* The player may have been removed or replaced. */ }
          };
          navigationTimer = setInterval(() => {
            try {
              if (currentVideoId() !== request.videoId ||
                target.getPlayerResponse()?.videoDetails?.videoId !== request.videoId) controller.abort();
            } catch { controller.abort(); }
          }, 100);
          let captured: { url: string; text: string } | undefined;
          const onCapture = (url: string, text: string) => {
            if (matches(url)) captured = { url, text };
          };
          captureListeners.add(onCapture);
          try {
            // Two bounded attempts handle an initial track selection before
            // YouTube's caption module has finished initializing.
            for (let attempt = 0; attempt < 2 && !captured; attempt++) {
              assertCurrent();
              if (userChanged) throw new Error("user-changed-captions");
              changed = true;
              target.setOption("captions", "track", {});
              await wait(150, signal);
              assertCurrent();
              if (userChanged) throw new Error("user-changed-captions");
              target.loadModule("captions");
              target.setOption("captions", "track", { languageCode: track.languageCode, ...(track.kind ? { kind: track.kind } : {}) });
              const captureDeadline = Date.now() + 3_000;
              while (!captured && Date.now() < captureDeadline) {
                if (userChanged) throw new Error("user-changed-captions");
                const current = target.getOption("captions", "track");
                if (current?.languageCode && (current.languageCode !== track.languageCode ||
                  (current.kind || "") !== (track.kind || ""))) {
                  userChanged = true;
                  throw new Error("user-changed-captions");
                }
                await wait(50, signal);
              }
            }
            assertCurrent();
            if (!captured) throw new Error("timeout");
            result = captured;
          } finally {
            captureListeners.delete(onCapture);
          }
        }
      } catch (error) {
        result = { error: (error as Error)?.name === "AbortError" ? "navigation" : (error as Error)?.message || "unavailable" };
      } finally {
        clearInterval(navigationTimer);
        restore?.();
        if (active?.requestId === request.requestId) active = null;
      }
      reply(result);
    })();
  }) as EventListener);
}

export {};
