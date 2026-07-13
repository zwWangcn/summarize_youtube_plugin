/**
 * Bilibili 内容脚本入口。
 *
 * 与 YouTube 入口结构相同，但使用 Bilibili 的提取器和注入位置。
 * 浏览器自动携带 Bilibili cookies，无需手动 SESSDATA。
 */

import { initContentScript, findBilibiliTarget, type Extractor } from "./shared";
import { getTranscript, getVideoTitle, isBilibiliVideoPage } from "./extractors/bilibili";

const extractor: Extractor = {
  getTranscript,
  getVideoTitle,
  getVideoId: () => {
    const match = window.location.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);
    return match?.[1] ?? "";
  },
  isOnVideoPage: isBilibiliVideoPage,
};

initContentScript(extractor, {
  source: "bilibili",
  findInjectTarget: findBilibiliTarget,
});
