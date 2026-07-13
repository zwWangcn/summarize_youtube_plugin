/**
 * Markdown 渲染 + 流式更新。
 * 使用 marked.js 渲染 Markdown，DOMPurify 做 XSS 防护。
 */

import { marked } from "marked";
import DOMPurify from "dompurify";
import { parseTimestampToSeconds } from "../../utils/text";

/** 配置 marked（options 可以在运行时设置） */
marked.setOptions({
  breaks: true,
  gfm: true,
});

/**
 * 匹配裸时间戳：M:SS / MM:SS / H:MM:SS / HH:MM:SS 等，冒号兼容全角「：」。
 * 不依赖外部括号（AI 输出格式不稳定，可能无括号或用圆括号）。
 * 前后不能是数字或冒号（lookbehind/lookahead），避免 123:456、12:345 被部分匹配；
 * 秒必须两位，避免误匹配「2:1」这类比例。
 */
const TIMESTAMP_RE = /(?<![\d:])(\d{1,2}[:：]\d{2}(?:[:：]\d{2})?)(?![\d:])/g;

/**
 * 遍历 root 下的文本节点，把其中的时间戳包成可点击 span。
 * 在 innerHTML 设置后、于已 sanitize 的 DOM 上执行——只处理文本内容，
 * 绝不碰标签/属性，因此宽泛匹配也不会破坏 HTML 结构。
 * span 由 createElement 创建、textContent 赋值，无注入风险。
 */
export function linkifyTimestampsInDom(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node = walker.nextNode() as Text | null;
  while (node) {
    const parent = node.parentElement;
    if (parent) {
      const tag = parent.tagName;
      // TIMESTAMP_RE 带 g 标志，test/exec 会保留 lastIndex，每次需重置
      TIMESTAMP_RE.lastIndex = 0;
      if (tag !== "SCRIPT" && tag !== "STYLE" && TIMESTAMP_RE.test(node.nodeValue ?? "")) {
        targets.push(node);
      }
    }
    node = walker.nextNode() as Text | null;
  }

  for (const textNode of targets) {
    linkifyTextNode(textNode);
  }
}

/** 将单个文本节点中的时间戳替换为 span（拆分文本，保留前后非时间戳部分）。 */
function linkifyTextNode(textNode: Text): void {
  const text = textNode.nodeValue ?? "";
  TIMESTAMP_RE.lastIndex = 0;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  const frag = document.createDocumentFragment();
  let found = false;

  while ((match = TIMESTAMP_RE.exec(text)) !== null) {
    const ts = match[1];
    const seconds = parseTimestampToSeconds(ts);
    if (seconds === null) continue;
    found = true;
    if (match.index > lastIdx) {
      frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
    }
    const span = document.createElement("span");
    span.className = "vas-ts";
    span.dataset.seconds = String(seconds);
    span.textContent = ts;
    frag.appendChild(span);
    lastIdx = match.index + match[0].length;
  }
  if (!found) return;
  if (lastIdx < text.length) {
    frag.appendChild(document.createTextNode(text.slice(lastIdx)));
  }
  textNode.parentNode?.replaceChild(frag, textNode);
}

/**
 * 渲染 Markdown 为安全的 HTML。
 */
export function renderMarkdown(markdown: string): string {
  const raw = marked.parse(markdown) as string;
  return DOMPurify.sanitize(raw);
}

/**
 * 将流式文本渲染到目标元素。每次调用全量替换内容。
 * 对于流式输出，简单地替换整个 innerHTML 在性能上可接受
 * （markdown 最大 16384 tokens ≈ 几十 KB）。
 *
 * 滚动策略：只有当用户本来就在底部时才自动跟随滚动；
 * 如果用户向上翻阅前面的内容，不强制拉回底部。
 */
export function renderStreaming(target: HTMLElement, markdown: string): void {
  const SCROLL_THRESHOLD = 3; // px，底部判定容错
  const wasAtBottom =
    target.scrollTop + target.clientHeight >=
    target.scrollHeight - SCROLL_THRESHOLD;
  const previousScrollTop = target.scrollTop;

  target.innerHTML = renderMarkdown(markdown);
  linkifyTimestampsInDom(target);

  if (wasAtBottom) {
    // 用户本来在底部——自动跟随最新内容
    target.scrollTop = target.scrollHeight;
  } else {
    // 用户正在向上翻阅——保持当前阅读位置不动
    target.scrollTop = previousScrollTop;
  }
}

/**
 * 渲染纯文本字幕到目标元素。
 */
export function renderTranscript(target: HTMLElement, text: string): void {
  target.innerHTML = `<pre class="vas-transcript">${escapeHtml(text)}</pre>`;
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
