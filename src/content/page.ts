/** YouTube page helpers that do not depend on content-script state. */

import type { AISetupStatus } from "../service/ai-setup";

interface YouTubePlayer {
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime?: () => number;
  playVideo?: () => void;
}

export async function requestAISetupStatus(fallback: AISetupStatus): Promise<AISetupStatus> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_API_KEY_STATUS" }) as Partial<AISetupStatus>;
    if (
      typeof response?.providerId === "string" &&
      typeof response.providerName === "string" &&
      typeof response.hasKey === "boolean"
    ) {
      return response as AISetupStatus;
    }
  } catch (error) {
    console.debug("[vas] AI setup status request failed:", error);
  }
  return fallback;
}

/** YouTube: find injection target — video player container (stable, rarely re-rendered) */
export function findYouTubeTarget(): HTMLElement | null {
  const selectors = [
    "#movie_player",           // ✅ 视频播放器容器（最稳定）
    "#player-container",       // fallback
    "#player",                 // fallback
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) continue;
    if (el.classList.contains("skeleton-bg-color")) continue;
    if (el.closest(".watch-skeleton")) continue;
    return el;
  }
  return null;
}

/** Wait for YouTube's asynchronously rendered player target. */
export function waitForTarget(
  findFn: () => HTMLElement | null,
  timeoutMs: number = 15000,
): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    // Fast path: already present
    const existing = findFn();
    if (existing) {
      resolve(existing);
      return;
    }

    // Watch DOM mutations
    const observer = new MutationObserver(() => {
      const el = findFn();
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Timeout fallback: poll every 500ms
    const pollInterval = setInterval(() => {
      const el = findFn();
      if (el) {
        clearInterval(pollInterval);
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    }, 500);

    const timer = setTimeout(() => {
      observer.disconnect();
      clearInterval(pollInterval);
      reject(new Error("Timeout waiting for injection target"));
    }, timeoutMs);
  });
}

export function isYouTubeDarkMode(): boolean {
  const root = document.documentElement;
  return root.hasAttribute("dark") || root.classList.contains("yt-dark-mode");
}

export function getCurrentPlaybackTime(): number {
  const player = document.querySelector("#movie_player") as unknown as YouTubePlayer | null;
  const playerTime = player?.getCurrentTime?.();
  if (Number.isFinite(playerTime)) return playerTime!;
  return document.querySelector("video")?.currentTime ?? 0;
}

export function seekPlayer(seconds: number): void {
  // 优先用 YouTube 播放器 API（同视频 SPA 内 seek，无网络请求）；
  // 回退到直接操作 <video>，兼容播放器 API 暂不可用的情况。
  const player = document.querySelector("#movie_player") as unknown as YouTubePlayer | null;
  if (player?.seekTo) {
    player.seekTo(seconds, true);
    player.playVideo?.();
    return;
  }
  const video = document.querySelector("video") as HTMLVideoElement | null;
  if (video) {
    video.currentTime = seconds;
    void video.play();
  }
}

export function watchNavigation(onChange: () => void): () => void {
  let lastUrl = window.location.href;
  const check = () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      onChange();
    }
  };

  // YouTube's own SPA event. DOM events cross the isolated-world boundary;
  // overriding history.pushState here would not (the page calls its own copy),
  // which is why that interception never fired and navigation was only noticed
  // whenever <title> happened to change after the URL.
  document.addEventListener("yt-navigate-finish", check);
  // Fallbacks: title changes and back/forward.
  const titleObserver = new MutationObserver(check);
  const titleEl = document.querySelector("title");
  if (titleEl) titleObserver.observe(titleEl, { childList: true, subtree: true });
  window.addEventListener("popstate", check);

  return () => {
    document.removeEventListener("yt-navigate-finish", check);
    titleObserver.disconnect();
    window.removeEventListener("popstate", check);
  };
}
