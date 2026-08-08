/**
 * Service Worker — 后台生命周期管理。
 *
 * 职责：
 *   - 安装/更新时的初始化
 *   - 监听扩展图标点击（打开 Popup 由 manifest 自动处理）
 *   - 处理跨组件消息（content script ↔ popup）
 */

import { streamAIText } from "../service/ai";
import { hasAnyApiKey } from "../service/storage";
import { clearExpiredCache } from "../service/summary-cache";
import {
  AI_STREAM_PORT,
  type AIStreamEvent,
  type AIStreamRequest,
} from "../service/ai-stream-protocol";

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
// Message routing
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "GET_API_KEY_STATUS": {
      // Only respond to messages from this extension (content scripts / popup),
      // not from other extensions or web pages sharing the runtime.
      if (sender.id !== chrome.runtime.id) {
        sendResponse({ hasKey: false });
        break;
      }
      // Let popup/content know if any API key is configured.
      hasAnyApiKey()
        .then((hasKey) => sendResponse({ hasKey }))
        .catch(() => sendResponse({ hasKey: false }));
      return true; // keep channel open for async response
    }

    default:
      // Ignore unknown messages
      break;
  }
});

// ---------------------------------------------------------------------------
// AI streaming bridge
// ---------------------------------------------------------------------------

function isAllowedAIClient(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  if (!sender.url) return true;
  try {
    const url = new URL(sender.url);
    return url.protocol === "chrome-extension:" ||
      url.hostname === "www.youtube.com" ||
      url.hostname === "youtube.com" ||
      url.hostname === "m.youtube.com";
  } catch {
    return false;
  }
}

function serializeAIError(error: unknown): Extract<AIStreamEvent, { type: "error" }> {
  const value = error as Error & { retryable?: boolean };
  return {
    type: "error",
    name: value?.name || "Error",
    message: value?.message || "AI stream failed",
    retryable: value?.retryable,
  };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== AI_STREAM_PORT) return;
  if (!port.sender || !isAllowedAIClient(port.sender)) {
    port.disconnect();
    return;
  }

  const controller = new AbortController();
  let started = false;
  let disconnected = false;
  port.onDisconnect.addListener(() => {
    disconnected = true;
    controller.abort();
  });

  const post = (event: AIStreamEvent): boolean => {
    if (disconnected) return false;
    try {
      port.postMessage(event);
      return true;
    } catch {
      disconnected = true;
      controller.abort();
      return false;
    }
  };

  port.onMessage.addListener((message: AIStreamRequest) => {
    if (started || message?.type !== "AI_STREAM_START") return;
    started = true;

    void (async () => {
      try {
        if (
          typeof message.systemPrompt !== "string" ||
          typeof message.userPrompt !== "string" ||
          message.systemPrompt.length > 100_000 ||
          message.userPrompt.length > 250_000
        ) {
          throw new Error("Invalid AI stream request");
        }
        for await (const token of streamAIText(
          message.systemPrompt,
          message.userPrompt,
          { ...message.options, signal: controller.signal },
        )) {
          if (!post({ type: "token", token })) return;
        }
        post({ type: "done" });
      } catch (error) {
        if (!disconnected) post(serializeAIError(error));
      }
    })();
  });
});

// Prevent service worker from being terminated during long operations
// (not strictly needed but good practice)
console.log("[vas] Service worker ready");
void clearExpiredCache().catch((error: unknown) => {
  console.debug("[vas] Summary cache cleanup failed:", error);
});
