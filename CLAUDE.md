# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Dev Commands

```bash
npm run dev       # Vite + CRXJS HMR — 修改代码后自动重载扩展
npm run build     # tsc 类型检查 + vite build → dist/
npm run preview   # vite preview（一般用不到，扩展直接加载 dist/）
```

构建产物在 `dist/` 目录，在 Chrome `chrome://extensions` 中「加载已解压的扩展程序」指向该目录即可。

`vite.config.ts` 在 build 命令下将两个内容脚本配置为 `standaloneFiles`，输出自包含 IIFE，由 Chrome 直接注入，避免内容脚本 loader 的 `chrome.runtime.getURL()` 动态导入触发跨源错误。serve 模式只有 MAIN 脚本独立打包，隔离脚本仍支持 HMR。构建后应检查 manifest 的内容脚本均存在且没有运行时 import；执行环境保持原 MAIN／ISOLATED 划分。

## Architecture

这是一个 **Chrome Extension Manifest V3** 项目，为 YouTube 视频提供 AI 驱动的流式总结。核心技术栈：TypeScript + Vite + CRXJS。

支持 8 家 AI 供应商（DeepSeek、OpenAI GPT、Anthropic Claude、Google Gemini、Moonshot Kimi、通义千问 Qwen、智谱 GLM、xAI Grok），通过 Provider Adapter 模式统一三种 API 格式（OpenAI-compat、Anthropic Messages、Gemini）。

### 组件模型与通信

```
content script (youtube.ts)
  ├── 实现 Extractor 接口（字幕提取、视频ID/标题、页面检测）
  ├── 调用 initContentScript(extractor, config) — shared.ts 只做装配与编排
  │     ├── 管理 Panel 生命周期（注入/销毁/SPA 重建）、设置变化、跨模块失效
  │     ├── SummaryController（summary-controller.ts）：AI 总结、总结翻译、总结缓存
  │     ├── CaptionSession（caption-session.ts）：字幕/分块/译文/翻译缓存/翻译队列的唯一持有者
  │     ├── TranscriptReader（transcript-reader.ts）：侧栏阅读器位置、懒加载、原文/译文视图
  │     └── BilingualController（bilingual-controller.ts）：播放器双语字幕、帧同步、预取、失败恢复
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

### 字幕提取：单一播放器路径

插件自身不直接 fetch 字幕或 player 元数据，全部经由播放器（避免额外请求触发 YouTube 429）：

1. **MAIN-world 观察器**（`caption-main.ts`，document_start）：包装 `fetch` / `XMLHttpRequest`，记录 timedtext 请求的开始/结束，缓存最近 12 条有效响应（5 分钟）。请求在正文读完并交给监听器后才算结束。捕获后派发不带正文的 `vas-caption-available` 通知。
2. **选轨**：等待当前视频的播放器 API 与轨道列表（最多 8 秒）；按「当前音轨语言 → 用户的优先字幕语言 → 第一条轨道」选择，同语言内人工字幕优先，中文简繁不互换，排除 `tlang` 翻译轨道。
3. **加载**：命中缓存直接返回；仅**在途**的同轨道请求值得等待（已结束但无可用字幕的请求不再阻塞）；否则像点 CC 一样 `setOption({})` → `loadModule('captions')` → 选择目标轨道。每次最多两轮，每轮最多一个匹配请求，请求结束即进入下一步；每个视频 2 分钟内最多主动触发 4 次。HTTP 429 进入冷却并遵守 `Retry-After`。
4. **用户操作判定**：只有点击 CC 按钮/字幕设置菜单或按 `c` 键才算用户更改并放弃；播放器自己切换轨道（外语视频自动字幕、`loadModule` 恢复上次语言）不算，进入加载前的自发切换会成为结束后恢复的基准。
5. **预算**：MAIN world 总预算 `CAPTION_LOAD_BUDGET_MS`（15 秒），隔离世界桥接 `PLAYER_CAPTION_BRIDGE_TIMEOUT_MS`（18 秒）；两者须同步修改。失败原因（`not-ready` / `timeout` / `user-changed-captions` / `no-captions`）映射为不同提示。
6. **自动恢复**：双语字幕自动加载失败后，收到同视频的 `vas-caption-available`（例如用户随后打开 CC）时自动重试一次，命中 MAIN-world 缓存。

同一视频的总结与双语字幕共享在途获取；失败后清除在途状态，允许重试。详见 `docs/caption-loading.md`。

### SPA 导航感知（page.ts / shared.ts）

通过以下事件感知 YouTube SPA 页面切换（`watchNavigation`）：
- YouTube 自身的 `yt-navigate-finish` DOM 事件（主路径）
- `MutationObserver` 监听 `<title>` 变化、`popstate`（兜底）

注意：内容脚本运行在隔离世界，重写 `history.pushState` 无法拦截页面自己的调用，不要再用这种方式。

切换视频时：离开视频页 → 销毁 Panel；进入新视频 → 等 800ms → 重新注入。状态依赖通过各控制器的 Host 接口显式注入，控制器之间不直接互相修改状态。另有 1s/3s/6s 的恢复检查，防止 YouTube skeleton → real DOM 切换时 UI 被移除。

### Panel UI 架构（panel.ts）

- **触发按钮**：普通 DOM 元素，注入到视频播放器容器内，通过 `bindToPlayer()` 跟随播放器 hover 状态显隐
- **面板**：Shadow DOM host 注入到 `<body>`（`position: fixed`），样式完全隔离
- **状态机**：`idle → loading → summary|transcript|translation|error`，由 `setMode()` 驱动 UI 切换
- 回调通过 `PanelCallbacks` 接口注入，shared.ts 把回调转发给各控制器

### AI 流式调用（service/ai.ts）

- 流式调用，使用 `fetch` + `ReadableStream` 手动解析 SSE
- `summarizeTextStream()` 返回 `AsyncGenerator<string>`，token 级别 yield
- 内置重试（最多 2 次，指数退避）：5xx、408、429 与网络错误可重试，429 遵守 `Retry-After`（超过 30 秒直接报错）；已向调用方交付过 token 的流不再重试（重试会从头重新生成，导致前端内容重复拼接）
- 后台保活（`background/stream-keepalive.ts`）：MV3 Service Worker 空闲 30 秒即被终止，等待首个 token 期间 fetch 收到数据也不算活动（Chrome 实测：响应头延迟、正文延迟、SSE 心跳三种情况都在 30.0 秒断开）。有流式请求时每 20 秒调用 `chrome.runtime.getPlatformInfo()` 重置空闲计时器，结束后停止
- `classifyHttpError()` 将 HTTP 失败映射为具体提示：401/403 Key 无效、402/配额类正文余额不足、429 限流、404/`model_not_found` 模型不存在、400 上下文超长，其余 4xx 为通用拒绝
- `ContentFilteredError`：各适配器将供应商的内容过滤信号统一映射为 `finishReason: "content_filter"`（OpenAI `content_filter`、Gemini `SAFETY`/`RECITATION` 等及 `promptFeedback.blockReason`、Anthropic `refusal`），由 `summarizeTextStream` 识别并抛出该错误

### 字幕翻译（1.5）

- `caption-source.ts` 本地规范化原始字幕、过滤独立及内嵌音乐标记，重映射剩余字符和时间标记；查看原文和摘要无需断句模型。
- chunk 根据原始字幕建立，保留 fast / balanced / context 预设和前后各最多 8 个原始事件上下文。
- 上传字幕（`isAutoGenerated=false`）按原始 cue 一对一翻译，强制保留边界、内部换行、开始时间和时长；只有自动生成字幕允许重新分段。来源类型参与源指纹，缓存协议版本变更时旧分段不能复用。
- `transcript-translation.ts` 自动字幕一次调用完成语义分段与翻译，返回 JSON `segments: [{source, translation}]`。原文在空白／Unicode NFC／直弯引号等价的坐标映射上从头逐段消费，最终文字仍取原始切片；禁止改字、跳过、重复、跨到上下文；切点必须有原始事件或有效文本标记的真实开始时间，禁止按字数插值。过长结果可做一次质量优化，失败保留已验证译文；粗粒度时间保留源粒度。
- 整块验证后原子提交，流式接收期间不显示或缓存部分结果。结构修复、网络重试及可选质量优化共享最多 3 次尝试预算，没有递归拆块请求。发生校验失败后，最后一次尝试改用客户端固定字幕单元、模型只返回编号和译文的备用协议，原文及时间仍由客户端构造。
- 侧栏和播放器共用 section 级分段及译文；已处理的块在原文模式也采用相同分段。播放优先当前块，按下一块真实开始时间预取；默认提前 30 秒真实时间，结合最近 3 次翻译耗时调至 30–90 秒，再按倍速换算。只预取紧邻下一块，跳转优先新位置。
- `translation-cache.ts` 缓存 7 天，身份包含视频、源语言、模型、目标语言、原始文字及时间 SHA-256、chunk 预设及流程版本；恢复时重新对齐时间。缓存清除会等待已开始写盘的旧任务，避免旧结果复活。
- 切视频、字幕轨道、模型、语言或分块预设时取消过期任务，阻止旧结果写回。播放器通过 `requestVideoFrameCallback` 跟随模型分段的时间同步。
- 源语言已匹配目标语言时不请求翻译。旧 `semantic-segmentation.ts` 只保留作回归对照，不进入产品主流程。
- UI 语言表静态打包，不在 YouTube 页 fetch 扩展 JSON 资源；结构、原文、时间和上传边界失败会分类并记录本地日志。自动字幕目标 3–5 秒；可读性参考原文 100 列／译文 64 列（CJK 按 2 列）及有足够文字时的词起始跨度，不把显示寿命当讲话时长，不因纯长度问题丢弃有效译文。
- `npm run build:test` 生成带测试标识的 1.5.1 扩展；`npm run build` 默认隐藏标识，`VITE_TEST_BUILD=true/false` 可显式覆盖。详见 `docs/1.5-development.md`。

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
| `src/content/shared.ts` | 装配与编排：创建控制器、设置变化、Panel 挂载、SPA 注入/导航 |
| `src/content/summary-controller.ts` | AI 总结与总结翻译（SummaryHost 接口） |
| `src/content/caption-session.ts` | 字幕、分块、译文、翻译缓存与翻译队列（CaptionSessionHost 接口） |
| `src/content/transcript-reader.ts` | 侧栏字幕阅读器 |
| `src/content/bilingual-controller.ts` | 播放器双语字幕与翻译按钮 |
| `src/content/page.ts` | 无状态页面工具：注入目标、导航监听、播放时间、跳转 |
| `src/content/ui/panel.ts` | Shadow DOM 面板 UI 组件与状态机 |
| `src/content/ui/renderer.ts` | Markdown/流式渲染（marked + DOMPurify） |
| `src/content/ui/styles.css` | Shadow DOM 暗色主题样式 |
| `src/content/ui/bilingual-overlay.ts` | 播放器内双语字幕、选区冻结和原生 CC 临时隐藏 |
| `src/content/extractors/youtube.ts` | 字幕获取入口、XML 解析与在途请求合并 |
| `src/content/caption-main.ts` | document_start MAIN-world fetch/XHR 观察器、选轨与播放器加载 |
| `src/content/extractors/player-captions.ts` | 隔离世界到 MAIN-world 的有界请求桥接、失败原因映射、字幕可用通知 |
| `src/content/extractors/caption-parsers.ts` | JSON3 字幕正文解析 |
| `src/content/caption-source.ts` | 原文坐标、真实切点时间、顺序覆盖校验与源指纹 |
| `src/content/semantic-segmentation.ts` | 旧规则算法，保留为回归对照 |
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
