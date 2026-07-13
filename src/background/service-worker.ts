/**
 * Service Worker — 后台生命周期管理。
 *
 * 职责：
 *   - 安装/更新时的初始化
 *   - 监听扩展图标点击（打开 Popup 由 manifest 自动处理）
 *   - 处理跨组件消息（content script ↔ popup）
 */

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("[vas] Extension installed");
    // Open options/popup on first install? Not needed — popup does setup.
  } else if (details.reason === "update") {
    console.log("[vas] Extension updated to", chrome.runtime.getManifest().version);
  }
});

// ---------------------------------------------------------------------------
// Caption interceptor (injected into YouTube MAIN world at document_start)
// ---------------------------------------------------------------------------
// This function MUST be self-contained — it gets serialized and injected.
function interceptorFunc(): void {
  const FLAG = "__vas_interceptor_installed";
  if ((window as unknown as Record<string, unknown>)[FLAG]) return;
  (window as unknown as Record<string, unknown>)[FLAG] = true;
  console.log("[vas] MAIN: interceptor installed");

  function isTimedtext(u: string): boolean {
    return u.includes("/api/timedtext");
  }
  function notify(url: string, text: string): void {
    if (!text) return;
    document.dispatchEvent(new CustomEvent("vas-caption-captured", {
      detail: { url, text },
    }));
  }

  // ---- Patch fetch ----
  const _fetch = window.fetch.bind(window);
  (window as unknown as Record<string, unknown>).fetch = function (
    url: RequestInfo | URL, opts?: RequestInit
  ): Promise<Response> {
    const urlStr: string = typeof url === "string" ? url : (url as Request).url || "";
    return _fetch(url, opts).then((resp: Response) => {
      if (isTimedtext(urlStr)) {
        resp.clone().text().then((t: string) => notify(urlStr, t)).catch(function () {});
      }
      return resp;
    });
  };

  // ---- Patch XMLHttpRequest PROTOTYPE (not constructor!) ----
  // Prototype patching works retroactively on already-created XHR instances.
  const OrigXHR = (window as unknown as Record<string, unknown>).XMLHttpRequest as typeof XMLHttpRequest;
  const origOpen = OrigXHR.prototype.open;
  const origSend = OrigXHR.prototype.send;

  OrigXHR.prototype.open = function (
    method: string, url: string | URL, async?: boolean, user?: string | null, password?: string | null
  ): void {
    (this as unknown as Record<string, unknown>).__vas_url = url.toString();
    return origOpen.call(this, method, url, async as boolean, user as string | null, password as string | null);
  };

  OrigXHR.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null): void {
    const url = (this as unknown as Record<string, unknown>).__vas_url as string | undefined;
    if (url && isTimedtext(url)) {
      this.addEventListener("readystatechange", function () {
        if (this.readyState === 4 && this.status === 200) {
          notify(url, this.responseText);
        }
      });
    }
    return origSend.call(this, body);
  };
}

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "INJECT_CAPTION_INTERCEPTOR": {
      if (!sender.tab?.id) {
        sendResponse({ ok: false, error: "no tab id" });
        break;
      }
      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [0] },
        func: interceptorFunc,
        world: "MAIN",
        injectImmediately: true,
      }).then(() => {
        sendResponse({ ok: true });
      }).catch((err: Error) => {
        console.warn("[vas] SW: injection failed:", err.message);
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    case "GET_API_KEY_STATUS": {
      // Only respond to messages from this extension (content scripts / popup),
      // not from other extensions or web pages sharing the runtime.
      if (sender.id !== chrome.runtime.id) {
        sendResponse({ hasKey: false });
        break;
      }
      // Let popup/content know if any API key is configured
      chrome.storage.sync.get(["apiKeys"], (result) => {
        const keys = result.apiKeys as Record<string, string> | undefined;
        const hasAnyKey = keys ? Object.values(keys).some((k) => k.length > 0) : false;
        sendResponse({ hasKey: hasAnyKey });
      });
      return true; // keep channel open for async response
    }

    default:
      // Ignore unknown messages
      break;
  }
});

// Prevent service worker from being terminated during long operations
// (not strictly needed but good practice)
console.log("[vas] Service worker ready");
