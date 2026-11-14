/** Keeps the MV3 service worker alive while AI streams are in flight. */

// MV3 terminates a service worker after 30 s without extension events or API
// calls. Waiting for a provider's first token (long transcripts, models that
// keep thinking) is exactly that: verified in Chrome to kill the stream at
// 30.0 s, whether the response headers are late, the body is late, or SSE
// keep-alive comments keep arriving. While a stream is active, a trivial
// extension API call resets the idle timer; afterwards the worker may idle out.
const STREAM_KEEPALIVE_INTERVAL_MS = 20_000;
let activeStreams = 0;
let streamKeepAlive: ReturnType<typeof setInterval> | null = null;

export function beginStreamKeepAlive(): () => void {
  activeStreams += 1;
  streamKeepAlive ??= setInterval(() => {
    void chrome.runtime.getPlatformInfo().catch(() => undefined);
  }, STREAM_KEEPALIVE_INTERVAL_MS);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    activeStreams -= 1;
    if (activeStreams === 0 && streamKeepAlive) {
      clearInterval(streamKeepAlive);
      streamKeepAlive = null;
    }
  };
}
