import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CAPTION_URL = "https://www.youtube.com/api/timedtext?v=video-a&lang=en&kind=asr&fmt=json3";
const CAPTIONS = JSON.stringify({ events: [{
  tStartMs: 1000, dDurationMs: 2000,
  segs: [{ utf8: "Ready ", tOffsetMs: 0 }, { utf8: "now", tOffsetMs: 500 }],
}] });
type Track = { languageCode?: string; kind?: string; [key: string]: unknown };

class FakePlayer extends EventTarget {
  videoId = "video-a";
  readyAt = 0;
  tracks: Track[] = [{ languageCode: "en", kind: "asr" }];
  track: Track = {};
  readonly classes = new Set<string>();
  readonly classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
  };
  readonly styles = new Set<{ remove(): void }>();
  captionClick = false;
  onSelect: (() => void) | undefined;
  getPlayerResponse = vi.fn(() => ({
    videoDetails: { videoId: this.videoId },
    captions: { playerCaptionsTracklistRenderer: {
      captionTracks: Date.now() >= this.readyAt ? this.tracks : [],
    } },
  }));
  getOption = vi.fn(() => this.track);
  setOption = vi.fn((_module: string, _option: string, track: Track) => {
    this.track = track;
    if (track.languageCode === "en") this.onSelect?.();
  });
  loadModule = vi.fn();
  appendChild(style: { remove(): void }): void { this.styles.add(style); }
  closest(): FakePlayer | null { return this.captionClick ? this : null; }
}

async function install() {
  const player = new FakePlayer();
  const pageLocation = { href: "https://www.youtube.com/watch?v=video-a" };
  const document = Object.assign(new EventTarget(), {
    documentElement: { outerHTML: "" },
    getElementById: (): FakePlayer | null => player,
    querySelectorAll: () => [],
    createElement: () => {
      const style = { textContent: "", remove: () => { player.styles.delete(style); } };
      return style;
    },
  });
  const originalFetch = vi.fn(async (_input: unknown) => ({
    ok: true,
    clone: () => ({ text: async () => CAPTIONS }),
  }));
  const window = Object.assign(new EventTarget(), { location: pageLocation, fetch: originalFetch });
  class FakeXHR extends EventTarget {
    open(): void {}
    send(): void {}
    status = 200;
    responseText = CAPTIONS;
  }
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("location", pageLocation);
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  // The extractor must never issue its own metadata/format probes.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Silent fetch unavailable"); }));
  player.onSelect = () => { void window.fetch(CAPTION_URL); };
  await import("./caption-main");
  const { getTranscript, clearTranscriptCache } = await import("./extractors/youtube");
  const { loadPlayerCaptions } = await import("./extractors/player-captions");
  return { player, window, document, pageLocation, getTranscript, clearTranscriptCache, loadPlayerCaptions, originalFetch, FakeXHR };
}

describe("cold-load player caption fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    { label: "English manual beats Japanese manual and English ASR", tracks: [
      { languageCode: "ja" }, { languageCode: "en", kind: "asr" }, { languageCode: "en" },
    ], expected: { languageCode: "en" } },
    { label: "one manual beats an English ASR track", tracks: [
      { languageCode: "en", kind: "asr" }, { languageCode: "ja" },
    ], expected: { languageCode: "ja" } },
    { label: "first manual wins without English", tracks: [
      { languageCode: "de", kind: "asr" }, { languageCode: "fr" }, { languageCode: "ja" },
    ], expected: { languageCode: "fr" } },
    { label: "regional English manual beats other manual languages", tracks: [
      { languageCode: "ja" }, { languageCode: "en-US" },
    ], expected: { languageCode: "en-US" } },
    { label: "ASR-only preserves order even with English available", tracks: [
      { languageCode: "de", kind: "asr" }, { languageCode: "en", kind: "asr" },
    ], expected: { languageCode: "de", kind: "asr" } },
  ])("selects captions: $label", async ({ tracks, expected }) => {
    const { player, window, getTranscript, originalFetch } = await install();
    player.tracks = tracks;
    player.setOption.mockImplementation((_module, _option, track) => {
      player.track = track;
      if (!track.languageCode) return;
      const url = new URL(CAPTION_URL);
      url.searchParams.set("lang", track.languageCode);
      if (track.kind) url.searchParams.set("kind", String(track.kind));
      else url.searchParams.delete("kind");
      void window.fetch(url.toString());
    });
    const request = getTranscript();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await request).toMatchObject({
      languageCode: expected.languageCode, isAutoGenerated: expected.kind === "asr",
    });
    expect(player.setOption.mock.calls[1][2]).toMatchObject(expected);
    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores a cached wrong language or ASR track and reuses only the selected manual track", async () => {
    const { player, window, getTranscript, originalFetch } = await install();
    player.tracks = [{ languageCode: "ja" }, { languageCode: "en", kind: "asr" }, { languageCode: "en" }];
    const manualEnglishUrl = CAPTION_URL.replace("&kind=asr", "");
    await window.fetch(CAPTION_URL.replace("lang=en", "lang=ja").replace("&kind=asr", ""));
    await window.fetch(CAPTION_URL);
    await vi.advanceTimersByTimeAsync(0);
    player.onSelect = () => { void window.fetch(manualEnglishUrl); };
    const request = getTranscript();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await request).toMatchObject({ languageCode: "en", isAutoGenerated: false });
    expect(originalFetch).toHaveBeenCalledTimes(3);
    expect(await getTranscript()).toMatchObject({ languageCode: "en", isAutoGenerated: false });
    expect(originalFetch).toHaveBeenCalledTimes(3);
  });

  it("reselects against changed tracks instead of returning a video-only cached result", async () => {
    const { player, window, getTranscript, originalFetch } = await install();
    const first = getTranscript();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await first).toMatchObject({ isAutoGenerated: true });
    player.tracks.push({ languageCode: "en" });
    player.onSelect = () => { void window.fetch(CAPTION_URL.replace("&kind=asr", "")); };
    const second = getTranscript();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await second).toMatchObject({ languageCode: "en", isAutoGenerated: false });
    expect(originalFetch).toHaveBeenCalledTimes(2);
  });

  it("clears only the requested video's source cache and fetches it again", async () => {
    const { getTranscript, clearTranscriptCache, originalFetch } = await install();
    const first = getTranscript();
    await vi.advanceTimersByTimeAsync(1_000);
    await first;
    clearTranscriptCache("video-b");
    await getTranscript();
    expect(originalFetch).toHaveBeenCalledTimes(1);
    clearTranscriptCache("video-a");
    expect(originalFetch).toHaveBeenCalledTimes(1);
    const fresh = getTranscript();
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await fresh).segments[0].text).toBe("Ready now");
    expect(originalFetch).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending extraction and discards its late native response after clearing", async () => {
    const { getTranscript, clearTranscriptCache, originalFetch } = await install();
    originalFetch.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return { ok: true, clone: () => ({ text: async () => CAPTIONS.replace("Ready ", "Stale ") }) };
    });
    const old = getTranscript().catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    clearTranscriptCache("video-a");
    expect(await old).toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(3_000);
    const fresh = getTranscript();
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await fresh).segments[0].text).toBe("Ready now");
    expect(originalFetch).toHaveBeenCalledTimes(2);
  });

  it("waits for delayed tracks and shares one extraction between summary and subtitles", async () => {
    const { player, document, getTranscript, originalFetch } = await install();
    player.readyAt = 600;
    vi.spyOn(document, "getElementById").mockImplementation(() => Date.now() < 400 ? null : player);
    const summary = getTranscript();
    const subtitles = getTranscript();
    expect(subtitles).toBe(summary);
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await summary;
    expect(result).toMatchObject({ languageCode: "en", isAutoGenerated: true,
      segments: [{ start: 1, duration: 2, text: "Ready now",
        timingMarkers: [{ offset: 0, start: 1 }, { offset: 6, start: 1.5 }] }] });
    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(player.loadModule).toHaveBeenCalledTimes(1);
    expect(player.track).toEqual({});
    expect(player.styles.size).toBe(0);
    expect(player.classes.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restores an originally enabled subtitle track, including its extra options", async () => {
    const { player, getTranscript } = await install();
    const original = { languageCode: "ja", vssId: ".ja", translationLanguage: { languageCode: "fr" } };
    player.track = original;
    const request = getTranscript();
    await vi.advanceTimersByTimeAsync(1_000);
    await request;
    expect(player.track).toEqual(original);
  });

  it("makes one player caption request on a cold load, even with ANDROID/page URLs available", async () => {
    const { player, window, getTranscript, originalFetch } = await install();
    Object.assign(window, {
      ytcfg: { get: () => "test-page-key" },
      ytInitialPlayerResponse: { videoDetails: { videoId: "video-a" },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [
          { baseUrl: CAPTION_URL, languageCode: "en", kind: "asr" },
        ] } } },
    });
    expect(originalFetch).not.toHaveBeenCalled();
    const summary = getTranscript();
    expect(getTranscript()).toBe(summary);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await summary).segments[0].text).toBe("Ready now");
    expect((await getTranscript()).segments[0].text).toBe("Ready now");
    expect(fetch).not.toHaveBeenCalled();
    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(player.loadModule).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for an initial native request taking over 3 seconds without triggering another", async () => {
    const { player, window, getTranscript, originalFetch } = await install();
    originalFetch.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      return { ok: true, clone: () => ({ text: async () => CAPTIONS }) };
    });
    const native = window.fetch(CAPTION_URL);
    const request = getTranscript();
    await vi.advanceTimersByTimeAsync(4_500);
    await native;
    expect((await request).segments[0].text).toBe("Ready now");
    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(player.setOption).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([0, 100])("does not repeat selection when module loading starts a request after %s ms", async (delay) => {
    const { player, window, getTranscript, originalFetch } = await install();
    player.loadModule.mockImplementation(() => { setTimeout(() => { void window.fetch(CAPTION_URL); }, delay); });
    const request = getTranscript();
    await vi.advanceTimersByTimeAsync(1_000);
    await request;
    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(player.setOption.mock.calls.every((call) => !call[2].languageCode)).toBe(true);
  });

  it("does not reselect the originally enabled target track during restoration", async () => {
    const { player, getTranscript, originalFetch } = await install();
    player.track = { languageCode: "en", kind: "asr" };
    const request = getTranscript();
    await vi.advanceTimersByTimeAsync(1_000);
    await request;
    expect(player.track).toEqual({ languageCode: "en", kind: "asr" });
    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(player.setOption).toHaveBeenCalledTimes(2);
  });

  it.each(["", "invalid", "120", "Thu, 01 Jan 1970 00:02:00 GMT"])(
    "reports native 429 without retrying and honors Retry-After %s", async (retryAfter) => {
      const { player, getTranscript, clearTranscriptCache, originalFetch, pageLocation } = await install();
      originalFetch.mockResolvedValueOnce({ ok: false, status: 429,
        headers: new Headers(retryAfter ? { "Retry-After": retryAfter } : {}),
        clone: () => ({ text: async () => "" }),
      } as unknown as Awaited<ReturnType<typeof originalFetch>>);
      const request = getTranscript().catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await request).toMatchObject({ code: "YT_RATE_LIMITED" });
      expect(originalFetch).toHaveBeenCalledTimes(1);
      expect(player.loadModule).toHaveBeenCalledTimes(1);
      clearTranscriptCache("video-a");
      pageLocation.href = "https://www.youtube.com/watch?v=video-b";
      player.videoId = "video-b";
      await expect(getTranscript()).rejects.toMatchObject({ code: "YT_RATE_LIMITED" });
      expect(originalFetch).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
      const delay = retryAfter === "" || retryAfter === "invalid" ? 60_000 : 120_000;
      await vi.advanceTimersByTimeAsync(delay);
      player.videoId = "video-a";
      pageLocation.href = "https://www.youtube.com/watch?v=video-a";
      const retry = getTranscript();
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await retry).segments[0].text).toBe("Ready now");
      expect(originalFetch).toHaveBeenCalledTimes(2);
    },
  );

  it("does not retry an empty response by reselecting the track", async () => {
    const { getTranscript, originalFetch, player } = await install();
    originalFetch.mockResolvedValue({ ok: true, clone: () => ({ text: async () => '{"events":[]}' }) });
    const request = getTranscript().catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await request).toMatchObject({ code: "YT_PLAYER_CAPTIONS", detail: "timeout" });
    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(player.loadModule).toHaveBeenCalledTimes(1);
  });

  it("does not act on a stale live player response during SPA initialization", async () => {
    const { player, getTranscript } = await install();
    player.videoId = "previous-video";
    const request = getTranscript();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(player.setOption).not.toHaveBeenCalled();
    player.videoId = "video-a";
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await request).segments[0].text).toBe("Ready now");
  });

  it("retries a caption selection that happened before the caption module was ready", async () => {
    const { player, window, getTranscript } = await install();
    let selections = 0;
    player.onSelect = () => { if (++selections === 2) void window.fetch(CAPTION_URL); };
    const request = getTranscript();
    await vi.advanceTimersByTimeAsync(4_000);
    expect((await request).segments[0].text).toBe("Ready now");
    expect(selections).toBe(2);
    expect(player.track).toEqual({});
  });

  it("does not finish on a nonempty timedtext envelope with no actual cues", async () => {
    const { window, originalFetch, getTranscript } = await install();
    originalFetch.mockResolvedValueOnce({ ok: true, clone: () => ({ text: async () => '{"events":[]}' }) });
    const request = getTranscript();
    let completed = false;
    void request.then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(completed).toBe(false);
    await window.fetch(CAPTION_URL);
    await vi.advanceTimersByTimeAsync(100);
    expect((await request).segments[0].text).toBe("Ready now");
  });

  it("reuses a response captured before the isolated content script registered", async () => {
    const { player, window, getTranscript, originalFetch } = await install();
    await window.fetch(CAPTION_URL);
    await vi.advanceTimersByTimeAsync(0);
    const result = await getTranscript();
    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.segments[0].text).toBe("Ready now");
    expect(player.setOption).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores other videos, languages and translated timedtext responses", async () => {
    const { player, window, loadPlayerCaptions } = await install();
    player.onSelect = () => {
      void window.fetch(CAPTION_URL.replace("video-a", "video-b"));
      void window.fetch(CAPTION_URL.replace("lang=en", "lang=ja"));
      void window.fetch(CAPTION_URL + "&tlang=ja");
    };
    const request = loadPlayerCaptions("video-a");
    let completed = false;
    void request.then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(completed).toBe(false);
    await window.fetch(CAPTION_URL);
    await vi.advanceTimersByTimeAsync(100);
    expect((await request).url).toBe(CAPTION_URL);
    expect(player.track).toEqual({});
  });

  it("also captures XMLHttpRequest responses", async () => {
    const { player, getTranscript, FakeXHR } = await install();
    player.onSelect = () => {
      const xhr = new FakeXHR();
      (xhr.open as (...args: unknown[]) => void)("GET", CAPTION_URL);
      xhr.send();
      xhr.dispatchEvent(new Event("load"));
    };
    const request = getTranscript();
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await request).segments[0].duration).toBe(2);
  });

  it("bounds a failed capture, restores captions and allows a fresh user retry", async () => {
    const { player, window, getTranscript } = await install();
    player.track = { languageCode: "ja" };
    player.onSelect = undefined;
    const failure = getTranscript().catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await failure).toMatchObject({ code: "YT_PLAYER_CAPTIONS" });
    expect(player.track).toEqual({ languageCode: "ja" });
    expect(player.styles.size).toBe(0);
    expect(player.classes.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    player.onSelect = () => { void window.fetch(CAPTION_URL); };
    const retry = getTranscript();
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await retry).segments[0].text).toBe("Ready now");
  });

  it("waits for readiness but eventually reports a genuine video without captions", async () => {
    const { player, getTranscript } = await install();
    player.tracks = [];
    const failure = getTranscript().catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(8_200);
    expect(await failure).toMatchObject({ code: "YT_PLAYER_CAPTIONS", detail: "no-captions" });
    expect(player.setOption).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([{ languageCode: "ja" }, { languageCode: "en", kind: "asr" }])("restores original track %j when the caption module throws", async (original) => {
    const { player, getTranscript } = await install();
    player.track = original;
    player.loadModule.mockImplementation(() => { throw new Error("Module unavailable"); });
    const failure = getTranscript().catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await failure).toMatchObject({ code: "YT_PLAYER_CAPTIONS" });
    expect(player.track).toEqual(original);
    expect(player.styles.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts on navigation without applying the old video's caption settings to the new one", async () => {
    const { player, pageLocation, getTranscript } = await install();
    player.track = { languageCode: "ja" };
    player.onSelect = undefined;
    const failure = getTranscript().catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(600);
    player.videoId = "video-b";
    player.track = { languageCode: "fr" };
    pageLocation.href = "https://www.youtube.com/watch?v=video-b";
    await vi.advanceTimersByTimeAsync(600);
    expect(await failure).toMatchObject({ name: "AbortError" });
    expect(player.track).toEqual({ languageCode: "fr" });
    expect(player.styles.size).toBe(0);
    expect(player.classes.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a manual CC toggle made while waiting for the response", async () => {
    const { player, getTranscript } = await install();
    player.track = { languageCode: "ja" };
    player.onSelect = undefined;
    const failure = getTranscript().catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(600);
    player.track = {};
    player.captionClick = true;
    player.dispatchEvent(new Event("click"));
    await vi.advanceTimersByTimeAsync(6_500);
    expect(await failure).toBeInstanceOf(Error);
    expect(player.track).toEqual({});
    expect(player.loadModule).toHaveBeenCalledTimes(1);
    expect(player.styles.size).toBe(0);
  });

  it("preserves a user-selected different language instead of retrying over it", async () => {
    const { player, getTranscript } = await install();
    player.track = { languageCode: "ja" };
    player.onSelect = undefined;
    const failure = getTranscript().catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(600);
    player.track = { languageCode: "fr" };
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await failure).toMatchObject({ code: "YT_PLAYER_CAPTIONS" });
    expect(player.track).toEqual({ languageCode: "fr" });
    expect(player.loadModule).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out cleanly when the MAIN-world bridge is unavailable", async () => {
    const { document, loadPlayerCaptions } = await install();
    // Mimic a missing MAIN script with a separate document event target.
    const isolatedDocument = new EventTarget();
    vi.stubGlobal("document", isolatedDocument);
    const failure = loadPlayerCaptions("video-a").catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(16_100);
    expect(await failure).toMatchObject({ code: "YT_PLAYER_TIMEOUT" });
    expect(vi.getTimerCount()).toBe(0);
    vi.stubGlobal("document", document);
  });
});
