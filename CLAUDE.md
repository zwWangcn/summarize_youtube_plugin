# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Dev Commands

```bash
npm run dev       # Vite + CRXJS HMR — 修改代码后自动重载扩展
npm run build     # tsc 类型检查 + vite build → dist/
npm run preview   # vite preview（一般用不到，扩展直接加载 dist/）
```

构建产物在 `dist/` 目录，在 Chrome `chrome://extensions` 中「加载已解压的扩展程序」指向该目录即可。

## Architecture

这是一个 **Chrome Extension Manifest V3** 项目，为 YouTube 视频提供 AI 驱动的流式总结。核心技术栈：TypeScript + Vite + CRXJS。

支持 8 家 AI 供应商（DeepSeek、OpenAI GPT、Anthropic Claude、Google Gemini、Moonshot Kimi、通义千问 Qwen、智谱 GLM、xAI Grok），通过 Provider Adapter 模式统一三种 API 格式（OpenAI-compat、Anthropic Messages、Gemini）。

### 组件模型与通信

```
content script (youtube.ts)
  ├── 实现 Extractor 接口（字幕提取、视频ID/标题、页面检测）
  ├── 调用 initContentScript(extractor, config) — shared.ts 中的主逻辑
  │     ├── 管理 Panel 生命周期（注入/销毁/SPA 重建）
  │     ├── 协调字幕获取 → AI 总结 → 流式渲染的完整流程
  │     └── 集成总结缓存（summary-cache.ts）的读写
  ├── 通过 service/ai-client.ts 请求后台执行流式 AI 调用
  └── UI 通过 Panel 类（Shadow DOM）渲染

background service worker (service-worker.ts)
  ├── 接收 AI_STREAM_PORT 请求并执行带超时/重试的供应商调用
  ├── 响应 GET_API_KEY_STATUS → 返回 API Key 是否已配置
  └── 安装/更新生命周期日志

popup (popup/popup.ts)
  └── 供应商/模型 → storage.sync；每个供应商的 API Key → 独立 storage.local key
```

### 多模型 AI 架构（service/ai/）

核心设计：**Provider Adapter 模式** — 三种 API 格式统一为一个接口：

```
service/ai.ts (summarizeTextStream)
  ├── 根据用户选择的 provider+model 查找 ProviderAdapter
  ├── 调用 adapter.buildStreamRequest() → 构建 HTTP 请求
  ├── fetch() + ReadableStream 逐行读取 SSE
  └── 每行调用 adapter.parseStreamChunk() → 统一为 StreamChunk { token?, finishReason? }

service/ai/types.ts           — ProviderAdapter 接口 + AIRequest/BuiltRequest/StreamChunk 类型
service/ai/openai-compat.ts   — OpenAI 兼容格式（适用于 DeepSeek、OpenAI、Kimi、Qwen、GLM、Grok）
service/ai/anthropic.ts       — Anthropic Messages API 格式
service/ai/gemini.ts          — Google Gemini 格式

service/model-registry.ts     — 集中式供应商+模型元数据注册表（PROVIDERS 数组）
```

**添加新供应商的步骤**：
1. 如果 API 格式是已有的三种之一（openai-compat / anthropic-messages / gemini），只需在 `model-registry.ts` 的 `PROVIDERS` 数组中追加一条配置
2. 如果是新的 API 格式，先创建新 adapter 实现 `ProviderAdapter` 接口，再注册到 `model-registry.ts`

**适配器选择逻辑**（`service/ai.ts`）：根据 `ProviderInfo.apiFormat` 分发：
- `"openai-compat"` → `openaiCompatAdapter`
- `"anthropic-messages"` → `anthropicAdapter`
- `"gemini"` → `geminiAdapter`

### 字幕提取的四路径架构

YouTube 字幕提取有四条路径，按优先级依次尝试：

1. **Interceptor 缓存**（无等待快速路径）：manifest 在 document_start 安装 MAIN-world 脚本，包装 `fetch` / `XMLHttpRequest`，观察播放器的 timedtext 响应。通过 DOM `CustomEvent`（`vas-caption-captured`）交给隔离世界缓存；命中即返回，不操作播放器。

2. **InnerTube ANDROID**（静默路径）：POST `youtubei/v1/player` 使用 ANDROID 客户端上下文（`clientName: "ANDROID"`, `clientVersion: "20.10.38"`），从响应获取字幕 `baseUrl`；优先解析 JSON3，再回退 XML。接口可用性取决于 YouTube，不能假定持续不受令牌限制。

3. **直接 fetch**（静默回退）：从当前视频的 `ytInitialPlayerResponse` 提取字幕 URL，尝试 JSON3/XML。静默路径的每次网络请求有 4 秒超时。

4. **播放器加载兜底**：`player-captions.ts` 请求 MAIN-world 的 `caption-main.ts`，最多等待 8 秒让当前视频播放器和字幕轨道就绪；复用最近响应，或通过 `loadModule('captions')` / `setOption('captions', 'track', ...)` 触发播放器取字幕。最多两次触发，每次等待约 3 秒；结束后恢复原 CC 状态，保留用户期间的主动更改，导航时取消旧请求。桥接总等待上限为 16 秒，不含先行静默请求。详见 `docs/caption-loading.md`。

同一视频的总结与双语字幕共享在途获取；失败后清除在途状态，允许重试。捕获只接受匹配的视频、语言和轨道类型，拒绝 `tlang` 翻译轨道和空字幕。

### SPA 导航感知（shared.ts）

通过三路拦截感知 YouTube SPA 页面切换：
- `MutationObserver` 监听 `<title>` 变化
- 重写 `history.pushState` / `history.replaceState`
- `popstate` 事件

切换视频时：离开视频页 → 销毁 Panel；进入新视频 → 等 800ms → 重新注入。另有 1s/3s/6s 的恢复检查，防止 YouTube skeleton → real DOM 切换时 UI 被移除。

### Panel UI 架构（panel.ts）

- **触发按钮**：普通 DOM 元素，注入到视频播放器容器内，通过 `bindToPlayer()` 跟随播放器 hover 状态显隐
- **面板**：Shadow DOM host 注入到 `<body>`（`position: fixed`），样式完全隔离
- **状态机**：`idle → loading → summary|transcript|translation|error`，由 `setMode()` 驱动 UI 切换
- 回调通过 `PanelCallbacks` 接口注入，业务逻辑在 shared.ts 中

### AI 流式调用（service/ai.ts）

- 流式调用，使用 `fetch` + `ReadableStream` 手动解析 SSE
- `summarizeTextStream()` 返回 `AsyncGenerator<string>`，token 级别 yield
- 内置重试（最多 2 次，指数退避，仅 5xx 与网络错误）：4xx（Key 错误、请求格式错等）标记为不可重试直接抛出；已向调用方交付过 token 的流不再重试（重试会从头重新生成，导致前端内容重复拼接）
- `ContentFilteredError`：各适配器将供应商的内容过滤信号统一映射为 `finishReason: "content_filter"`（OpenAI `content_filter`、Gemini `SAFETY`/`RECITATION` 等及 `promptFeedback.blockReason`、Anthropic `refusal`），由 `summarizeTextStream` 识别并抛出该错误

### 字幕翻译

- 字幕内部使用 `Transcript` / `TranscriptSegment` 保存语言、固定时间、原文、JSON3 逐词时间及原始 source ID 范围；`semantic-segmentation.ts` 先合并完整上下文，由 SentenceX WASM、标点、停顿、禁断词及引号状态生成候选切点，再用动态规划全局选择语义边界；所选边界优先映射 JSON3 逐词时间，缺失时才局部插值，AI 不参与断句或计时
- `transcript-translation.ts` 要求模型为每个固定 `cueId` 返回恰好一条 NDJSON 译文，禁止合并、拆分和返回时间戳；每行校验后立即渲染，并复用本地 cue 时间；播放器通过 `requestVideoFrameCallback` 的媒体时间逐帧同步
- 播放器内的 `BilingualSubtitleOverlay` 与字幕阅读器共用 cue 级译文和缓存；从播放位置预取约 60 秒，剩余不足 15 秒时续取
- API 网络错误在无输出时由底层指数退避重试；字幕流在部分输出后断开时会整批重启一次。耗尽后播放器字幕层提供当前窗口重试按钮，并清除页面级失败锁
- DeepSeek 翻译请求显式关闭默认 thinking 模式；翻译流有首次响应与停滞超时，避免长时间无反馈
- 翻译使用用户选择的目标语言，保守修正 ASR 错词，不做音频级时间校准；源字幕已匹配目标语言时不发起翻译请求
- `translation-cache.ts` 按视频、源语言、供应商、模型和流程版本缓存 7 天

### 提示词模板（service/prompts.ts）

System Prompt 使用 YouTube 专用上下文，侧重多语种术语、核心论点和赞助内容识别，并拼接目标输出语言约束。

### 总结缓存（service/summary-cache.ts）

- 存储后端：`chrome.storage.local`（每条总结独立 key，避免多标签页覆盖）
- TTL：7 天，惰性清理
- 容量控制：最多 50 条，超出按 LRU 淘汰最旧条目
- UI 显示缓存时间，用户可点击「再次总结」强制刷新

### 关键文件速查

| 文件 | 职责 |
|---|---|
| `src/content/shared.ts` | 核心编排逻辑：注入、SPA 感知、Panel 生命周期、回调实现 |
| `src/content/ui/panel.ts` | Shadow DOM 面板 UI 组件与状态机 |
| `src/content/ui/renderer.ts` | Markdown/流式渲染（marked + DOMPurify） |
| `src/content/ui/styles.css` | Shadow DOM 暗色主题样式 |
| `src/content/ui/bilingual-overlay.ts` | 播放器内双语字幕、选区冻结和原生 CC 临时隐藏 |
| `src/content/extractors/youtube.ts` | 四路径字幕获取、JSON3/XML 解析与在途请求合并 |
| `src/content/caption-main.ts` | document_start MAIN-world fetch/XHR 观察器及播放器加载兜底 |
| `src/content/extractors/player-captions.ts` | 隔离世界到 MAIN-world 的有界请求桥接及导航取消 |
| `src/content/extractors/caption-interceptor.ts` | 隔离世界中的字幕事件接收和有界内存缓存 |
| `src/content/semantic-segmentation.ts` | 候选切点评分、动态规划选路与原始时间轴映射 |
| `src/content/sentence-boundary-detector.ts` | SentenceX WASM 初始化、UTF-16 边界转换及 Intl 回退 |
| `src/service/ai.ts` | AI 流式调用主入口：适配器分发、SSE 解析、重试、翻译回退 |
| `src/service/ai/types.ts` | ProviderAdapter 接口定义 |
| `src/service/ai/openai-compat.ts` | OpenAI 兼容格式适配器（DeepSeek/OpenAI/Kimi/Qwen/GLM/Grok） |
| `src/service/ai/anthropic.ts` | Anthropic Messages API 适配器 |
| `src/service/ai/gemini.ts` | Google Gemini API 适配器 |
| `src/service/model-registry.ts` | 供应商+模型元数据注册表（PROVIDERS 数组），添加新模型只需改此文件 |
| `src/service/prompts.ts` | YouTube 总结提示词与目标语言约束 |
| `src/service/summary-cache.ts` | chrome.storage.local 持久化缓存 + LRU 淘汰 |
| `src/service/transcript-translation.ts` | 字幕分块、AI 翻译、结构化输出校验 |
| `src/service/translation-cache.ts` | 翻译结果 7 天缓存 |
| `src/service/storage.ts` | Chrome Storage 封装（API Key/模型选择持久化） |
| `src/background/service-worker.ts` | 后台 Service Worker：消息路由、AI 流式网络请求 |
| `src/utils/text.ts` | 时间格式化、字幕拼接、时间戳切换 |
| `src/popup/popup.ts` | 设置弹窗（供应商选择 → 模型选择 → API Key） |

### 平台入口

manifest 在 `document_start` 安装 MAIN-world caption observer；`youtube.ts` 注册结果监听器，`getVideoId` 始终从当前 URL 参数 `v` 提取。
