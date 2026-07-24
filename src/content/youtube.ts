/**
 * YouTube 内容脚本入口。
 *
 * CRXJS 会为每个 content_scripts entry 创建独立的 bundle。
 * 本文件是 YouTube 的入口，负责：
 *   1. 实现 Extractor 接口（基于 YouTube 页面数据）
 *   2. 调用 initContentScript 启动 UI
 */

import { initContentScript, findYouTubeTarget, type Extractor } from "./shared";
import { getTranscript, getVideoTitle, getVideoIdFromUrl, isYouTubeVideoPage } from "./extractors/youtube";
import { initCaptionInterceptor } from "./extractors/caption-interceptor";

// Install caption interceptor — piggybacks YouTube player's timedtext requests
initCaptionInterceptor();

const extractor: Extractor = {
  getTranscript,
  getVideoTitle,
  getVideoId: getVideoIdFromUrl,
  isOnVideoPage: isYouTubeVideoPage,
};

initContentScript(extractor, {
  source: "youtube",
  enableTranslation: true,
  findInjectTarget: findYouTubeTarget,
});
