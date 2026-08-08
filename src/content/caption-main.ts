/**
 * 在 YouTube MAIN world、document_start 阶段安装字幕请求观察器。
 * 此文件必须保持自包含；捕获结果通过 DOM CustomEvent 交给隔离世界。
 */

const FLAG = "__vas_interceptor_installed";
const mainWindow = window as unknown as Record<string, unknown>;

if (!mainWindow[FLAG]) {
  mainWindow[FLAG] = true;

  const isTimedText = (url: string) => url.includes("/api/timedtext");
  const notify = (url: string, text: string) => {
    if (!text) return;
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
      if (isTimedText(url)) {
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
}

export {};
