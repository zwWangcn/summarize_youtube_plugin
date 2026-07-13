# 🤖 视频 AI 总结 — Chrome 扩展

> 🌐 简体中文 | [English](README.en.md)

AI 驱动的 YouTube / Bilibili 视频内容总结工具。一键提取字幕，流式生成结构化中文总结。支持 **8 家 AI 供应商、20+ 模型**自由切换。

## 为什么用 Chrome 扩展？

传统的 Python Web 服务在 WSL/服务器环境中会受到 YouTube 反爬策略的限制（验证页面、IP 封禁等）。Chrome 扩展在**真实浏览器环境**中运行，直接解析页面数据，完美跳过反爬检测。

## 功能

- ✅ **多模型自由切换** — 支持 DeepSeek、OpenAI GPT、Anthropic Claude、Google Gemini、Moonshot Kimi、通义千问 Qwen、智谱 GLM、xAI Grok，覆盖 20+ 模型，Popup 中一键切换
- ✅ **一键 AI 总结** — 点击页面上的"AI 总结"按钮，流式生成结构化 Markdown 总结
- ✅ **字幕原文查看** — 查看 AI 字幕原文，支持时间戳切换
- ✅ **实时流式渲染** — token 级别的流式输出，像 ChatGPT 一样逐字生成
- ✅ **SPA 导航感知** — 在 YouTube/Bilibili 的 SPA 页面中自动检测视频切换
- ✅ **多语言字幕** — 智能选择最佳语言字幕（YouTube: ja > en > zh；Bilibili: zh > en）
- ✅ **自动翻译保证** — AI 输出若非中文，自动触发翻译回退
- ✅ **总结缓存** — 7 天 TTL，LRU 淘汰，同一视频无需重复调用 AI
- ✅ **Shadow DOM 隔离** — 注入 UI 样式与页面完全隔离，互不影响

## 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                    Chrome 扩展 (MV3)                          │
│                                                              │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  Popup   │  │  Background  │  │     Content Scripts    │  │
│  │  设置页   │  │  Service     │  │                       │  │
│  │          │  │  Worker      │  │ youtube.ts             │  │
│  │ 供应商选择 │  │ 生命周期管理   │  │ bilibili.ts            │  │
│  │ 模型选择  │  │ 消息路由      │  └───────────┬───────────┘  │
│  │ API Key  │  │ 拦截器注入    │              │              │
│  └──────────┘  └──────────────┘  ┌───────────┴───────────┐  │
│                                   │    shared.ts           │  │
│                                   │   共享主逻辑             │  │
│                                   └───────────┬───────────┘  │
│                          ┌───────────────────┼─────────┐    │
│                     ┌────▼────┐  ┌────────────▼──────┐│    │
│                     │Extractors│  │   Panel (Shadow   ││    │
│                     │字幕提取   │  │   DOM UI 组件     ││    │
│                     └────┬─────┘  └────────┬──────────┘│    │
│                          │                 │            │    │
│                ┌─────────▼─────────┐  ┌────▼──────────┐│    │
│                │   AI 服务层        │  │   Renderer    ││    │
│                │  ┌─────────────┐  │  │   Markdown    ││    │
│                │  │ Adapter 层   │  │  │   流式渲染     ││    │
│                │  │ 3 种 API 格式│  │  └──────────────┘│    │
│                │  │ 8 家供应商   │  │                   │    │
│                │  └─────────────┘  │                   │    │
│                └───────────────────┘                   │    │
└──────────────────────────────────────────────────────────────┘
```

## 多模型 AI 架构

项目核心亮点：通过 **Provider Adapter 模式** 统一了三种异构 API 格式，上层调用完全一致。

### 适配器模式设计

```
summarizeTextStream(transcript, providerId, modelId)
  │
  ├── model-registry.ts  → 查找 ProviderInfo（baseURL, apiFormat）
  ├── service/ai.ts      → 根据 apiFormat 选择适配器
  │
  ├── "openai-compat"  → openaiCompatAdapter  (OpenAI / DeepSeek / Kimi / Qwen / GLM / Grok)
  ├── "anthropic-messages" → anthropicAdapter  (Claude)
  └── "gemini"         → geminiAdapter        (Gemini)
  │
  └── 统一 StreamChunk { token?, finishReason? } → AsyncGenerator<string>
```

### 三种 API 格式对照

| API 格式 | 供应商 | 请求方式 | 认证头 | 流式事件格式 |
|----------|--------|---------|--------|-------------|
| `openai-compat` | OpenAI, DeepSeek, Kimi, Qwen, GLM, Grok | POST `/v1/chat/completions` | `Authorization: Bearer` | SSE `data: {"choices":[{"delta":{"content":"..."}}]}` |
| `anthropic-messages` | Anthropic Claude | POST `/v1/messages` | `x-api-key` | SSE `content_block_delta` / `message_delta` / `message_stop` |
| `gemini` | Google Gemini | POST `/models/{model}:streamGenerateContent?alt=sse&key=` | URL Query `key` 参数 | SSE `{"candidates":[{"content":{"parts":[{"text":"..."}]}}]}` |

### 添加新供应商/模型

只需修改 `src/service/model-registry.ts` 的 `PROVIDERS` 数组：

```typescript
// 如果 API 格式与已有供应商相同，只需添加配置：
{
  id: "new-provider",
  name: "New Provider",
  baseURL: "https://api.new-provider.com/v1",
  apiFormat: "openai-compat",  // 复用已有适配器
  docsUrl: "https://...",
  iconLetter: "NP",
  models: [{ id: "model-id", name: "Model Name", ... }],
}
```

如果 API 格式完全不同，则需先创建新 adapter 实现 `ProviderAdapter` 接口（`service/ai/types.ts`）。

## 实现原理

### 1. 字幕提取 — 两个平台的差异化策略

#### YouTube — 三路径架构

YouTube 字幕提取有三条路径，按优先级依次尝试：

| 优先级 | 路径 | 原理 | 超时 |
|--------|------|------|------|
| 1 | **Interceptor 缓存** | Service Worker 注入 MAIN world，patch `fetch`/`XHR` 拦截 YouTube 播放器的 timedtext 请求 | 3s |
| 2 | **InnerTube ANDROID** | POST `youtubei/v1/player` 使用 ANDROID 客户端上下文，绕过 WEB POT 限制 | — |
| 3 | **直接 fetch** | 从 `ytInitialPlayerResponse` 提取字幕 URL 直接请求（可能因 POT 返回空） | — |

**路径 1（Interceptor）**：在 MAIN world 中 patch `fetch`/`XMLHttpRequest`，当 YouTube 播放器发起 timedtext 请求时（带 POT 签名），将响应缓存。通过 DOM `CustomEvent`（`vas-caption-captured`）跨 isolated-world 边界传回内容脚本。这是**最快路径**，但前提是 CC 已开启且播放器发起了请求。

**路径 2（InnerTube ANDROID）**：参考 `youtube-transcript-api`，使用 Android 客户端身份请求 YouTube Internal API，完全静默——无需 CC 按钮、无需播放器操作、无需 MAIN world 注入。

**路径 3（直接 fetch）**：兜底方案。

Bilibili 无此多路径 — 浏览器自动携带 cookies，直接调用 `api.bilibili.com` API 即可。

### 2. SPA 导航感知

YouTube 和 Bilibili 都是 SPA（单页应用），用户切换视频不会触发完整页面加载。插件通过三路拦截感知导航事件：

| 拦截方式 | 实现 |
|----------|------|
| `MutationObserver` | 监听 `<title>` 元素变化 |
| `history.pushState / replaceState` | 重写 History API，在调用后检测 URL 变化 |
| `popstate` 事件 | 监听浏览器前进/后退 |

视频切换时的行为：
- 离开视频页 → 销毁面板
- 进入新视频 → 等待 800ms（等 DOM 渲染完成）→ 重新注入面板
- 已存在面板 → 重置状态 + 更新标题
- 1s/3s/6s 恢复检查，防止 YouTube skeleton → real DOM 切换时 UI 被移除

### 3. 注入位置智能探测

页面 DOM 结构随 YouTube/Bilibili 迭代频繁变化，采用**多选择器回退策略**：

```
YouTube: #title h1 → h1.ytd-watch-metadata → #movie_player → #columns → #primary-inner
Bilibili: .video-title → .video-info-title → h1[data-title] → #bilibiliPlayer → #bpx-player-container → #playerWrap
```

配合 `MutationObserver` + 500ms 轮询双重机制，最多等待 20 秒直到目标元素就绪。

### 4. Shadow DOM 样式隔离

注入的面板使用 **Shadow DOM** 与页面完全隔离：

```typescript
container.attachShadow({ mode: "open" })
// 内联注入 styles.css（通过 Vite ?inline 导入）
// 页面 CSS 无法穿透 Shadow boundary，面板样式不受页面主题影响
```

暗色主题 UI（`#1f2937` 背景 + 紫蓝渐变按钮），在任何页面上保持一致的视觉效果。

### 5. AI 流式调用

```
字幕文本（截断至 200K 字符）
  → 选择供应商适配器（openai-compat / anthropic-messages / gemini）
  → 构建流式 HTTP 请求（URL + Headers + Body 因 API 格式而异）
  → fetch() + ReadableStream + TextDecoder 逐行解析 SSE
  → adapter.parseStreamChunk() 统一提取 StreamChunk
  → AsyncGenerator 逐个 yield token
  → 前端 renderStreaming() 逐字渲染 + Markdown 解析
```

安全与可靠性机制：
- **Content Filter 检测**：捕获内容过滤事件并抛出专用错误
- **自动翻译回退**：输出文本中文字符占比 < 30% 时，自动调用翻译接口
- **智能重试**：最多 2 次，指数退避，仅对 5xx 重试，4xx 不重试
- **API Key 本地存储**：使用 `chrome.storage.sync` 存储，不经过任何服务器

### 6. 提示词工程

每个平台有差异化的 System Prompt，共享 BASE_RULES：

| 维度 | YouTube | Bilibili |
|------|---------|----------|
| 核心关注 | 多语种术语、国际多元主题 | 社区文化、网络流行语、弹幕梗 |
| 术语处理 | 保留原文 + 中文解释 | 保留圈层语汇 + 简要解释 |
| 特殊识别 | 赞助/推广片段 | 一键三连、充电等互动环节 |
| 内容过滤 | 区分观点 vs 举例/类比 | 区分严肃论述 vs 玩梗/整活 |
| 弹幕处理 | 不适用 | 识别弹幕转写，非核心讨论可略过 |

共享基座规则：简体中文、时间戳标注、Markdown 格式、高信息密度、AI 错别字修正。

### 7. 总结缓存

- 存储后端：`chrome.storage.local`（单一 key `vas-summaries`）
- TTL：7 天，惰性清理（读取时检查过期）
- 容量控制：最多 50 条，超出按 LRU 淘汰最旧条目
- UI 显示缓存时间，用户可点击「再次总结」强制刷新

## 安装

### 开发模式

```bash
# 1. 安装依赖
npm install

# 2. 构建
npm run build

# 3. 在 Chrome 中加载
#    打开 chrome://extensions
#    开启「开发者模式」
#    点击「加载已解压的扩展程序」
#    选择 dist/ 目录
```

### 开发 + 热更新

```bash
npm run dev
# Vite + CRXJS 提供 HMR，修改代码后会自动重载扩展
```

## 使用

### 设置 AI 供应商和模型

1. 获取 API Key（任选一个供应商）：
   - [DeepSeek](https://platform.deepseek.com/api_keys) — 推荐国内用户首选，快速经济
   - [OpenAI](https://platform.openai.com/api-keys) — GPT-5 系列
   - [Anthropic](https://console.anthropic.com/keys) — Claude 系列
   - [Google Gemini](https://aistudio.google.com/apikey) — 超长上下文
   - [Moonshot Kimi](https://platform.kimi.ai) — 中文原生优化
   - [通义千问](https://bailian.console.aliyun.com/#/api-key) — 阿里云
   - [智谱 GLM](https://open.bigmodel.cn/usercenter/apikeys) — 高性价比中文
   - [xAI Grok](https://console.x.ai) — 多语言理解
2. 点击 Chrome 工具栏中的扩展图标
3. 选择供应商 → 选择模型 → 填写 API Key → 保存

### 总结视频

1. 打开任意 YouTube 或 Bilibili 视频页面
2. 在视频标题旁找到 **🤖 AI 总结** 按钮（自动注入）
3. 点击按钮，面板从右侧滑入
4. 点击 **AI 总结** — 实时流式生成结构化总结
5. 点击 **字幕原文** — 查看原始字幕（可切换时间戳）
6. 使用 **📋 复制** 按钮快速拷贝内容

## 技术栈

| 层 | 选型 |
|---|---|
| 扩展框架 | Chrome Extension Manifest V3 |
| 语言 | TypeScript (strict mode) |
| 构建 | Vite 6 + CRXJS |
| AI 引擎 | DeepSeek V4 / GPT-5 / Claude Sonnet 5 / Gemini 2.5 / Kimi K2.6 / Qwen3 / GLM-5.2 / Grok 4.3 |
| API 适配 | Provider Adapter 模式（OpenAI-compat / Anthropic Messages / Gemini 三种格式） |
| Markdown | marked.js + DOMPurify |
| 样式隔离 | Shadow DOM + CSS Custom Properties |
| 存储 | chrome.storage.sync（设置）+ chrome.storage.local（缓存） |

## 项目结构

```
src/
├── manifest.json                     # MV3 配置（权限、host、content_scripts）
├── background/
│   └── service-worker.ts             # 生命周期管理 + 消息路由 + 拦截器注入
├── content/
│   ├── youtube.ts                    # YouTube 入口（Extractor 实现 + interceptor 安装）
│   ├── bilibili.ts                   # Bilibili 入口
│   ├── shared.ts                     # 共享逻辑：注入探测、SPA 导航感知、Panel 生命周期
│   ├── extractors/
│   │   ├── youtube.ts                # YouTube 字幕提取（三路径：interceptor / InnerTube / 直接 fetch）
│   │   ├── bilibili.ts               # Bilibili 字幕提取（__INITIAL_STATE__ → API → JSON → 文本）
│   │   └── caption-interceptor.ts   # YouTube MAIN world 注入的 fetch/XHR 拦截器
│   └── ui/
│       ├── panel.ts                  # 浮层面板组件（Shadow DOM、状态机、注入逻辑）
│       ├── renderer.ts               # Markdown/流式渲染（marked + DOMPurify）
│       └── styles.css                # Shadow DOM 暗色主题样式
├── service/
│   ├── ai.ts                         # AI 流式调用主入口：适配器分发、SSE 解析、重试、翻译回退
│   ├── ai/
│   │   ├── types.ts                  # ProviderAdapter 接口 + 公共类型定义
│   │   ├── openai-compat.ts          # OpenAI 兼容格式适配器
│   │   ├── anthropic.ts              # Anthropic Messages API 适配器
│   │   └── gemini.ts                 # Google Gemini API 适配器
│   ├── model-registry.ts             # 供应商+模型元数据注册表（PROVIDERS 数组）
│   ├── prompts.ts                    # 提示词模板（YouTube/Bilibili 差异化策略）
│   ├── summary-cache.ts              # chrome.storage.local 持久化缓存 + LRU 淘汰
│   └── storage.ts                    # Chrome Storage 封装
├── popup/
│   ├── popup.html/css/ts             # 设置弹窗（供应商选择 → 模型选择 → API Key）
└── utils/
    └── text.ts                       # 文本工具：时间格式化、字幕拼接、时间戳开关
```

## 设计亮点

1. **Provider Adapter 架构** — 三种异构 API 格式统一为一个接口，上层零感知。添加新供应商只需注册配置，无需改动业务逻辑
2. **零服务端成本** — 全部在浏览器中运行，不需要任何后端服务器，用户 API Key 存储在本地 Chrome Sync Storage
3. **YouTube 三路径字幕提取** — Interceptor 缓存（快速）+ InnerTube ANDROID（可靠）+ 直接 fetch（兜底），最大化可用性
4. **SPA 原生感知** — 通过拦截 `history` API + `MutationObserver` + `popstate`，无缝适配 YouTube/Bilibili 的单页导航
5. **Shadow DOM 隔离** — 注入 UI 样式与页面完全隔离，暗色主题在任何页面上表现一致
6. **流式渲染** — Token 级别的流式输出，用户体验接近 ChatGPT
7. **语言智能回退** — 自动检测 AI 输出语言，非中文时自动触发翻译
8. **平台化 Prompt** — YouTube 和 B 站使用不同的提示词策略，理解各自的社区文化与内容特征
9. **总结缓存** — 7 天 TTL + LRU 淘汰，减少重复 AI 调用
10. **浏览器环境优势** — B 站 API 请求自动携带用户登录 Cookies，无需手动管理会话凭证

## 对比旧项目

| 特性 | 旧项目 (Python) | Chrome 扩展 |
|---|---|---|
| 运行环境 | WSL / Docker | 浏览器 |
| 反爬处理 | 依赖第三方库 | 原生页面解析 ✅ |
| 部署 | FastAPI + Celery + Redis | 纯客户端 ✅ |
| API Key | 服务器 .env | 本地存储（不上传给开发者）✅ |
| Bilibili 登录 | 手动 SESSDATA | 浏览器自动 cookies ✅ |
| URL 输入 | 手动粘贴 | 自动检测页面 ✅ |
| 启动 | docker compose up | 点击按钮 ✅ |
| AI 模型 | 单一模型 | 8 家供应商、20+ 模型自由切换 ✅ |
