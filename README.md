# 🤖 视频 AI 总结 — Chrome 扩展

> 🌐 简体中文 | [English](README.en.md)

AI 驱动的 YouTube / Bilibili 视频总结工具。一键提取字幕并流式生成结构化总结，支持 8 家 AI 供应商、20+ 模型自由切换。

## 功能

- **多模型自由切换** — DeepSeek / OpenAI / Claude / Gemini / Kimi / Qwen / GLM / Grok，20+ 模型 Popup 一键切换
- **一键 AI 总结** — 流式生成结构化 Markdown 总结
- **多语言输出** — YouTube 总结和字幕翻译支持简中、繁中、英、日、韩、西、法、德 8 种语言
- **界面 i18n** — 扩展界面随 Chrome 使用简中、繁中、日语、韩语或英语，其他语言回退到英语
- **字幕原文查看** — 支持点击时间戳跳转
- **字幕分段翻译** — 在字幕原文中按需翻译当前分段，也可断点续译全文
- **实时流式渲染** — token 级逐字输出
- **SPA 导航感知** — 自动检测视频切换
- **多语言字幕** — 智能选择最佳语言（YouTube: ja > en > zh；Bilibili: zh > en）
- **语言隔离缓存** — 不同输出语言独立缓存，7 天 TTL，LRU 淘汰

## 实现原理

### 多模型 AI 架构

通过 Provider Adapter 模式统一三种异构 API 格式，上层调用一致：

| API 格式 | 供应商 | 请求 | 认证 |
|---|---|---|---|
| `openai-compat` | OpenAI / DeepSeek / Kimi / Qwen / GLM / Grok | POST `/v1/chat/completions` | `Authorization: Bearer` |
| `anthropic-messages` | Claude | POST `/v1/messages` | `x-api-key` |
| `gemini` | Gemini | POST `/models/{model}:streamGenerateContent` | URL `key` 参数 |

适配器将各供应商流式响应统一为 `StreamChunk { token?, finishReason? }`。添加新供应商只需在 `src/service/model-registry.ts` 的 `PROVIDERS` 数组追加配置；若是新 API 格式，则先实现 `ProviderAdapter` 接口（`src/service/ai/types.ts`）。

### 字幕提取

**YouTube — 三路径，按优先级依次尝试：**

1. **Interceptor 缓存**（3s 超时）— Service Worker 在 MAIN world patch `fetch`/`XHR`，拦截播放器的 timedtext 请求（带 POT 签名）并缓存，通过 DOM `CustomEvent` 跨 isolated-world 边界传回。
2. **InnerTube ANDROID** — 以 ANDROID 客户端上下文 POST `youtubei/v1/player`，绕过 WEB 的 POT 限制，完全静默。
3. **直接 fetch** — 从 `ytInitialPlayerResponse` 提取字幕 URL 直接请求，兜底。

**Bilibili** — 浏览器自动携带 cookies，直接调用 `api.bilibili.com`。

### 字幕翻译与修正

YouTube 的翻译功能内嵌于「字幕原文」。字幕按字符量自动分段，打开时定位当前播放位置，上下滚动按需加载原文；滚动不会自动调用 AI。可翻译当前分段、重新翻译单段，或点击「翻译全文」补齐尚未完成的分段，并在原文/译文之间切换。

处理时会按上下文合并自动字幕中被错误切碎的片段，并保守修正可以确定的识别错误。每个完成分段按目标语言独立缓存 7 天，关闭面板或切换到总结后全文任务仍会继续；再次翻译全文时只补齐缺失部分。不会下载音频或重新校准语音时间轴；源字幕已经属于目标语言时不会调用翻译 AI。

### 界面与输出语言

manifest、Popup 和 YouTube 面板使用 Chrome 原生 i18n，界面随 Chrome 显示简体中文、繁體中文、日本語、한국어或 English；其他 Chrome 界面语言默认显示英语。Popup 中的 **YouTube 输出语言** 是独立设置：首次按 Chrome 语言初始化，之后固定为用户选择。输出当前支持简体中文、繁體中文、English、日本語、한국어、Español、Français 和 Deutsch。Bilibili 总结暂时保持简体中文输出。

### SPA 导航感知

YouTube / Bilibili 均为 SPA，通过三路拦截感知导航：`MutationObserver` 监听 `<title>`、重写 `history.pushState`/`replaceState`、`popstate` 事件。切换视频时销毁旧面板，800ms 后重新注入，并有 1s/3s/6s 恢复检查应对 skeleton → real DOM 切换。

### Shadow DOM 隔离

面板以 Shadow DOM 注入 `<body>`（`position: fixed`），样式与页面完全隔离，暗色主题跨页一致。

### AI 流式调用

`fetch` + `ReadableStream` 逐行解析 SSE → `adapter.parseStreamChunk()` 统一提取 token → `AsyncGenerator` 逐个 yield。

- 内容过滤信号统一映射为 `ContentFilteredError`
- YouTube 使用英文模块化 system prompt 拼接受控的目标语言约束
- 仅对 5xx 与网络错误重试（最多 2 次，指数退避），4xx 不重试
- API Key 仅存于当前设备的 `chrome.storage.local`；调用时只直接发送给用户选择的 AI 服务商，不经过开发者服务器

### 总结缓存

`chrome.storage.local`，7 天 TTL 惰性清理，最多 50 条，超出按 LRU 淘汰。YouTube 总结和字幕译文均把目标语言纳入缓存身份，不会跨语言复用。

## 使用方法

### 安装

```bash
npm install
npm run build
```

打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择 `dist/` 目录。

开发热更新：`npm run dev`

### 配置

1. 获取 API Key（任选一个供应商）：
   - [DeepSeek](https://platform.deepseek.com/api_keys)
   - [OpenAI](https://platform.openai.com/api-keys)
   - [Anthropic](https://console.anthropic.com/keys)
   - [Google Gemini](https://aistudio.google.com/apikey)
   - [Moonshot Kimi](https://platform.kimi.ai)
   - [通义千问](https://bailian.console.aliyun.com/#/api-key)
   - [智谱 GLM](https://open.bigmodel.cn/usercenter/apikeys)
   - [xAI Grok](https://console.x.ai)
2. 点击扩展图标 → 选供应商、模型和 YouTube 输出语言 → 填 API Key → 保存

### 总结视频

1. 打开 YouTube 或 Bilibili 视频页
2. 点击标题旁的 **🤖 AI 总结** 按钮
3. 面板从右侧滑入，点击 **AI 总结** 流式生成
4. 点击 **字幕原文** 查看原始字幕（可点时间戳跳转）
5. YouTube 字幕语言与目标语言不同时，可点击 **翻译本段** 或 **翻译全文**，并用 **原文 / 译文** 切换查看

## License

[MIT](LICENSE)

## 隐私

请参阅[隐私政策](PRIVACY.md)。
