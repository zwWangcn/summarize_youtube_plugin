/**
 * 在 YouTube MAIN world、document_start 阶段安装字幕请求观察器。
 * 此文件必须保持自包含；捕获结果通过 DOM CustomEvent 交给隔离世界。
 */

const FLAG = "__vas_interceptor_installed";
// Keep in sync with PLAYER_CAPTION_BRIDGE_TIMEOUT_MS in player-captions.ts
// (this file must stay self-contained, so the value cannot be imported).
const CAPTION_LOAD_BUDGET_MS = 15_000;
// Extension-initiated player loads per video, so repeated retries can never
// turn into a request storm even when responses keep coming back empty.
const MAX_TRIGGERS_PER_VIDEO = 4;
const TRIGGER_WINDOW_MS = 2 * 60_000;
const mainWindow = window as unknown as Record<string, unknown>;

interface PlayerTrack {
  languageCode?: string;
  kind?: string;
  [key: string]: unknown;
}

interface CaptionRenderer {
  captionTracks?: PlayerTrack[];
  audioTracks?: { audioTrackId?: string; captionTrackIndices?: number[]; defaultCaptionTrackIndex?: number }[];
  defaultAudioTrackIndex?: number;
}

interface AudioLanguageInfo {
  id?: string;
  languageCode?: string;
  language?: string;
}

interface PlayerAudioTrack extends AudioLanguageInfo {
  audioTrackId?: string;
  getLanguageInfo?(): AudioLanguageInfo | null;
}

interface CaptionPlayer extends HTMLElement {
  getAudioTrack?(): PlayerAudioTrack | null;
  getPlayerResponse(): {
    videoDetails?: { videoId?: string; title?: string };
    captions?: { playerCaptionsTracklistRenderer?: CaptionRenderer };
  };
  getOption(module: string, option: string): PlayerTrack | undefined;
  setOption(module: string, option: string, track: PlayerTrack): void;
  loadModule(module: string): void;
}

// No language recognition: inspect only explicit player/audio metadata.
function audioLanguage(player: CaptionPlayer, renderer: CaptionRenderer): string | null {
  const fromId = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const code = value.split(".")[0];
    return !["und", "mul", "zxx"].includes(code.toLowerCase()) &&
      /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(code) ? code : null;
  };
  let selected: ReturnType<NonNullable<CaptionPlayer["getAudioTrack"]>> | undefined;
  try { selected = player.getAudioTrack?.(); } catch { /* API may not be ready. */ }
  // YouTube can expose language through a method on the audio-track object,
  // rather than through the object's own id/language fields. Keep its receiver.
  let info: AudioLanguageInfo | null | undefined;
  try { info = selected?.getLanguageInfo?.(); } catch { /* Retain legacy metadata fallbacks. */ }
  const currentLanguage = fromId(info?.languageCode) ?? fromId(info?.language) ?? fromId(info?.id);
  if (currentLanguage) return currentLanguage;
  const explicit = fromId(selected?.languageCode) ?? fromId(selected?.language);
  if (explicit) return explicit;
  const selectedId = selected?.id ?? selected?.audioTrackId;
  // The literal "default" is an unresolved placeholder, not a language.
  const resolvedId = selectedId && selectedId !== "default" ? selectedId : null;
  const selectedLanguage = fromId(resolvedId);
  if (selectedLanguage) return selectedLanguage;
  const audioTracks = renderer.audioTracks ?? [];
  const audio = resolvedId
    ? audioTracks.find((item) => item.audioTrackId === resolvedId)
    : Number.isInteger(renderer.defaultAudioTrackIndex)
      ? audioTracks[renderer.defaultAudioTrackIndex!]
      : audioTracks.length === 1 ? audioTracks[0] : undefined;
  const language = fromId(audio?.audioTrackId);
  if (language) return language;
  // Only infer from associated caption indices if they unambiguously identify
  // one language. A translated default caption alone does not prove audio language.
  const codes = (audio?.captionTrackIndices ?? [])
    .filter((index) => Number.isInteger(index) && index >= 0)
    .map((index) => renderer.captionTracks?.[index]?.languageCode).filter((code): code is string => !!code);
  if (codes.length && codes.every((code) => code.toLowerCase() === codes[0].toLowerCase())) return codes[0];
  return null;
}

function chooseCaptionTrack(tracks: PlayerTrack[], audio: string | null, preferred: unknown): PlayerTrack {
  const normalize = (code: string) => code.toLowerCase().replaceAll("_", "-");
  const match = (language: unknown) => {
    if (typeof language !== "string" || !language || language.length > 35) return undefined;
    const code = normalize(language);
    const exact = tracks.filter((track) => normalize(track.languageCode!) === code);
    // Chinese script variants must not be treated as interchangeable.
    const candidates = exact.length ? exact : code.split("-")[0] === "zh" ? [] :
      tracks.filter((track) => normalize(track.languageCode!).split("-")[0] === code.split("-")[0]);
    return candidates.find((track) => track.kind !== "asr") ?? candidates[0];
  };
  return match(audio) ?? match(preferred) ?? tracks[0];
}

if (!mainWindow[FLAG]) {
  mainWindow[FLAG] = true;

  const recentCaptions = new Map<string, { url: string; text: string; timestamp: number }>();
  // Observe starts as well as bodies so a slow native request is never
  // mistaken for a missing request and triggered again by the extension.
  const captionRequests = new Map<object, { url: string; startedAt: number; pending: boolean }>();
  let rateLimitedUntil = 0;
  const triggerTimes = new Map<string, number[]>();
  const takeTriggerBudget = (videoId: string): boolean => {
    const now = Date.now();
    const recent = (triggerTimes.get(videoId) ?? []).filter((time) => now - time < TRIGGER_WINDOW_MS);
    const allowed = recent.length < MAX_TRIGGERS_PER_VIDEO;
    if (allowed) recent.push(now);
    triggerTimes.delete(videoId);
    triggerTimes.set(videoId, recent);
    if (triggerTimes.size > 20) triggerTimes.delete(triggerTimes.keys().next().value!);
    return allowed;
  };
  const startRequest = (url: string): object => {
    const token = {};
    captionRequests.set(token, { url, startedAt: Date.now(), pending: true });
    if (captionRequests.size > 32) captionRequests.delete(captionRequests.keys().next().value!);
    return token;
  };
  const finishRequest = (token: object, status: number, retryAfter: string | null = null) => {
    const request = captionRequests.get(token);
    if (request && !request.pending) return;
    if (request) request.pending = false;
    if (status !== 429) return;
    const seconds = retryAfter?.trim() ? Number(retryAfter) : NaN;
    const delay = Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
    rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() +
      (Number.isFinite(delay) && delay > 0 ? delay : 60_000));
  };
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
    // Body-free notice: lets the isolated world recover a failed load after the
    // player (or the user's CC click) fetched captions, without copying the body.
    document.dispatchEvent(new CustomEvent("vas-caption-available", {
      detail: {
        videoId: parsed.searchParams.get("v"),
        lang: parsed.searchParams.get("lang"),
        kind: parsed.searchParams.get("kind") || "",
      },
    }));
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const token = captionUrl(url) ? startRequest(url) : null;
    return originalFetch(input, init).then((response) => {
      const finish = () => {
        if (token) finishRequest(token, response.status, response.headers?.get("Retry-After"));
      };
      if (response.ok && isTimedText(url) && (!token || captionRequests.has(token))) {
        // A request is finished only once its body was read and offered to the
        // capture listeners; headers alone would let the loader re-trigger
        // while a large caption body is still streaming.
        void response.clone().text().then((text) => {
          if (!token || captionRequests.has(token)) notify(url, text);
        }).catch(() => {}).finally(finish);
      } else {
        finish();
      }
      return response;
    }, (error) => {
      if (token) finishRequest(token, 0);
      throw error;
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
      const token = captionUrl(url) ? startRequest(url) : null;
      const finish = () => {
        if (token) finishRequest(token, this.status, this.getResponseHeader?.("Retry-After"));
      };
      this.addEventListener("loadend", finish, { once: true });
      this.addEventListener("load", function () {
        finish();
        try {
          if (this.status === 200 && typeof this.responseText === "string" &&
            (!token || captionRequests.has(token))) {
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
  let active: { requestId: string; videoId: string; controller: AbortController } | null = null;
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

  document.addEventListener("vas-player-caption-clear", ((event: CustomEvent) => {
    const videoId = event.detail?.videoId;
    if (typeof videoId !== "string" || !videoId || videoId.length > 100) return;
    if (active?.videoId === videoId) active.controller.abort();
    for (const [key, body] of recentCaptions) {
      if (captionUrl(body.url)?.searchParams.get("v") === videoId) recentCaptions.delete(key);
    }
    for (const [token, body] of captionRequests) {
      if (captionUrl(body.url)?.searchParams.get("v") === videoId) captionRequests.delete(token);
    }
    // Rate limiting is not a cache: clearing must never bypass a 429 cooldown.
  }) as EventListener);

  document.addEventListener("vas-player-caption-request", ((event: CustomEvent) => {
    const request = event.detail;
    if (
      typeof request?.requestId !== "string" || request.requestId.length > 100 ||
      typeof request.videoId !== "string" || request.videoId !== currentVideoId()
    ) return;
    // The isolated extractor shares requests. Cancel obsolete probes before
    // starting another so two requests can never toggle the player together.
    const previous = active;
    previous?.controller.abort();
    const controller = new AbortController();
    active = { requestId: request.requestId, videoId: request.videoId, controller };
    const { signal } = controller;
    const assertCurrent = () => {
      if (signal.aborted || currentVideoId() !== request.videoId) {
        throw new DOMException("Navigation changed", "AbortError");
      }
    };
    type Failure = { error: string; retryAfterSeconds?: number };
    const reply = (body: { url: string; text: string; title?: string } | Failure) => {
      document.dispatchEvent(new CustomEvent("vas-player-caption-result", {
        detail: { requestId: request.requestId, videoId: request.videoId, ...body },
      }));
    };
    void (async () => {
      // Let the cancelled request's finally block restore its original state.
      await Promise.resolve();
      let restore: (() => void) | undefined;
      let navigationTimer: ReturnType<typeof setInterval> | undefined;
      let result: { url: string; text: string; title?: string } | Failure;
      let videoTitle = "";
      try {
        assertCurrent();
        // One budget for the whole MAIN-world load, so the isolated bridge
        // (which waits slightly longer) never gives up while this side still works.
        const loadDeadline = Date.now() + CAPTION_LOAD_BUDGET_MS;
        const remaining = () => Math.max(0, loadDeadline - Date.now());
        const readyDeadline = Date.now() + 8_000;
        let player: CaptionPlayer | null = null;
        let tracks: PlayerTrack[] = [];
        let renderer: CaptionRenderer = {};
        let matchedPlayer = false;
        while (Date.now() < readyDeadline) {
          assertCurrent();
          player = document.getElementById("movie_player") as CaptionPlayer | null;
          try {
            const response = player?.getPlayerResponse();
            matchedPlayer = response?.videoDetails?.videoId === request.videoId;
            // The player response matched by video ID is the reliable title source
            // after SPA navigation (page globals and <title> can still be stale).
            const title = matchedPlayer ? response?.videoDetails?.title : undefined;
            if (typeof title === "string") videoTitle = title.trim().slice(0, 300);
            renderer = matchedPlayer ? response?.captions?.playerCaptionsTracklistRenderer ?? {} : {};
            tracks = matchedPlayer
              ? (renderer.captionTracks ?? [])
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
        const audio = audioLanguage(target, renderer);
        const track = chooseCaptionTrack(tracks, audio, request.preferredCaptionLanguage);
        console.debug("[vas] Caption track selected", {
          videoId: request.videoId, audioLanguage: audio,
          preferredCaptionLanguage: request.preferredCaptionLanguage,
          captionLanguage: track.languageCode, kind: track.kind || "manual",
        });
        const matches = (value: string) => {
          const url = captionUrl(value);
          return url !== null && url.searchParams.get("v") === request.videoId &&
            url.searchParams.get("lang") === track.languageCode &&
            (url.searchParams.get("kind") || "") === (track.kind || "");
        };
        // Retain responses that arrived before the isolated script registered.
        const cached = [...recentCaptions.values()].find((body) =>
          Date.now() - body.timestamp < 5 * 60_000 && matches(body.url));
        if (cached) {
          result = { ...cached, title: videoTitle };
        } else {
          const assertNotLimited = () => {
            if (Date.now() < rateLimitedUntil) throw new Error("rate-limited");
          };
          assertNotLimited();
          const sameTrack = (value: PlayerTrack | undefined, other: PlayerTrack) =>
            (value?.languageCode || "") === (other.languageCode || "") &&
            (value?.kind || "") === (other.kind || "");
          let original: PlayerTrack = { ...target.getOption("captions", "track") };
          let originalIsTarget = sameTrack(original, track) && !original.translationLanguage;
          // Only real input counts as a user change. The player also switches
          // tracks by itself (auto-captions for foreign-language videos, the
          // sticky CC language restored by loadModule); treating that as the
          // user aborted loads that a manual CC click would then "fix".
          let userChanged = false;
          let changed = false;
          const onClick = (event: Event) => {
            if ((event.target as Element | null)?.closest?.(".ytp-subtitles-button, .ytp-settings-menu")) {
              userChanged = true;
            }
          };
          const onKey = (event: KeyboardEvent) => {
            // composedPath()[0] is the real target: inside a shadow root (our own
            // panel's question box) event.target is retargeted to the host.
            const element = (event.composedPath?.()[0] ?? event.target) as Element | null;
            if (event.key?.toLowerCase() === "c" && !event.ctrlKey && !event.metaKey && !event.altKey &&
              !element?.closest?.("input, textarea, [contenteditable]")) userChanged = true;
          };
          target.addEventListener("click", onClick, true);
          document.addEventListener("keydown", onKey as EventListener, true);
          const style = document.createElement("style");
          style.textContent = "#movie_player.vas-caption-probe .ytp-caption-window-container{visibility:hidden!important}";
          target.appendChild(style);
          target.classList.add("vas-caption-probe");
          restore = () => {
            target.removeEventListener("click", onClick, true);
            document.removeEventListener("keydown", onKey as EventListener, true);
            style.remove();
            target.classList.remove("vas-caption-probe");
            try {
              // Never apply the old video's preference to a new SPA video or
              // override a caption choice the user made during this probe.
              if (!changed || userChanged ||
                currentVideoId() !== request.videoId ||
                target.getPlayerResponse()?.videoDetails?.videoId !== request.videoId) return;
              const current = target.getOption("captions", "track");
              if (originalIsTarget && current && current.languageCode === original.languageCode &&
                (current.kind || "") === (original.kind || "") && !current.translationLanguage) return;
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
            // Only an in-flight request is worth waiting for. A finished one that
            // produced no usable cues (early empty envelope, HTTP error) must not
            // block loading: previously it did for 30 s, which is why a manual
            // CC click was needed. HTTP 429 remains authoritative via the cooldown.
            const pendingMatch = () => [...captionRequests.values()].some((item) =>
              item.pending && matches(item.url));
            const requestedSince = (time: number) => [...captionRequests.values()].some((item) =>
              item.startedAt >= time && matches(item.url));
            const throwIfUserChanged = () => {
              if (userChanged) throw new Error("user-changed-captions");
            };
            // Waits up to `ms`, or until `settled` reports that the request being
            // waited for has finished without usable captions: there is no point
            // in sitting out the rest of the window before the next step.
            const waitForCapture = async (ms: number, settled?: () => boolean) => {
              const deadline = Date.now() + Math.min(ms, remaining());
              while (!captured && Date.now() < deadline) {
                assertCurrent();
                assertNotLimited();
                throwIfUserChanged();
                if (settled?.()) return;
                if (!changed) {
                  // The player picked a track on its own before we touched it:
                  // adopt that as the state to restore afterwards.
                  const current = target.getOption("captions", "track");
                  if (!sameTrack(current, original)) {
                    original = { ...current };
                    originalIsTarget = sameTrack(original, track) && !original.translationLanguage;
                  }
                }
                await wait(50, signal);
              }
            };
            // Give the player's own startup request a chance to begin, then wait
            // for any matching request that is still in flight.
            const notPending = () => !pendingMatch();
            await waitForCapture(300);
            if (!captured && pendingMatch()) await waitForCapture(6_000, notPending);
            // Ask the player to load the track, like a CC click would. Each attempt
            // causes at most one matching request; a second attempt covers both a
            // caption module that was not ready and an empty/failed response.
            for (let attempt = 0; attempt < 2 && !captured && remaining() > 0; attempt++) {
              assertCurrent();
              assertNotLimited();
              throwIfUserChanged();
              if (pendingMatch() || !takeTriggerBudget(request.videoId)) break;
              const attemptStartedAt = Date.now();
              changed = true;
              target.setOption("captions", "track", {});
              await wait(150, signal);
              assertCurrent();
              throwIfUserChanged();
              target.loadModule("captions");
              // Module loading can start the saved track asynchronously.
              await wait(150, signal);
              assertCurrent();
              assertNotLimited();
              throwIfUserChanged();
              if (!captured && !requestedSince(attemptStartedAt)) {
                target.setOption("captions", "track", originalIsTarget ? original : {
                  languageCode: track.languageCode, ...(track.kind ? { kind: track.kind } : {}),
                });
              }
              await waitForCapture(3_000, () => requestedSince(attemptStartedAt) && notPending());
              if (!captured && pendingMatch()) await waitForCapture(3_000, notPending);
            }
            assertCurrent();
            if (!captured) throw new Error("timeout");
            result = { ...captured, title: videoTitle };
          } finally {
            captureListeners.delete(onCapture);
          }
        }
      } catch (error) {
        result = { error: (error as Error)?.name === "AbortError" ? "navigation" : (error as Error)?.message || "unavailable" };
        if (result.error === "rate-limited") {
          result.retryAfterSeconds = Math.max(1, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
        }
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
