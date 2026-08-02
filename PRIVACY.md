# Privacy Policy / 隐私政策

Last updated / 最后更新：2026-08-02

## 中文

### 概述

“视频 AI 总结”是一款在 YouTube 页面提取字幕，并使用用户主动选择的第三方 AI 服务生成总结或字幕翻译的 Chrome 扩展。扩展不运营用于接收 API Key、视频字幕或 AI 输出的开发者服务器，也不出售用户数据。

### 扩展处理的数据

- **API Key**：用户为 DeepSeek、OpenAI、Anthropic、Google Gemini、Moonshot、阿里云通义千问、智谱 GLM 或 xAI 提供的访问凭证。
- **网站内容**：用户主动处理的视频标题、视频标识和字幕文本。
- **设置**：所选 AI 服务商、模型和输出语言。
- **生成内容**：AI 返回的总结与字幕译文。

### 数据的存储位置

- API Key 保存在当前设备的 `chrome.storage.local`，不通过 `chrome.storage.sync` 同步。
- 服务商、模型和输出语言等非敏感设置保存在 `chrome.storage.sync`；启用 Chrome 同步时，这些设置可能同步到用户登录的其他 Chrome 浏览器。
- 总结和字幕译文缓存在 `chrome.storage.local`，保留期最长为 7 天，并受数量上限控制。
- 界面偏好保存在 `chrome.storage.local`。

### 数据的传输和使用

只有在用户主动点击总结或翻译功能后，扩展才会把所选视频的字幕、生成请求和对应 API Key 通过 HTTPS 直接发送给用户选择的 AI 服务商。数据由该服务商依据其条款和隐私政策处理。

扩展会直接访问 YouTube 的页面和接口，以获取当前视频信息及可用字幕。为提高字幕获取成功率，扩展会在页面内本地监听页面自身的字幕响应；这项监听本身不会把数据发送给开发者或 AI 服务商。扩展不会把 API Key、字幕或 AI 输出发送给开发者控制的服务器。

### 数据共享

除完成用户主动请求所必需的 AI 服务商及视频平台通信外，开发者不会向第三方出售、出租或共享用户数据。数据不会用于广告、信用评估或与扩展单一用途无关的活动。

本扩展对从 Chrome API 获得的信息的使用遵守 [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use)，包括 Limited Use 要求。

### 用户控制和删除

用户可以在扩展弹窗中删除当前设备保存的全部 API Key。卸载扩展会删除该设备上的扩展本地数据；用户也可以通过 Chrome 的扩展管理功能清除数据。第三方 AI 服务商已接收的数据应按照对应服务商提供的控制方式管理或删除。

### 安全说明

所有外部请求均使用 HTTPS。API Key 保存在 Chrome 提供的扩展存储中，但不会被宣传为操作系统级加密保险库。请勿在公共或不受信任的设备上保存 API Key，并建议为本扩展创建独立、可撤销且设有合理额度限制的 Key。

### 联系方式

如有隐私问题，请通过项目的 [GitHub Issues](https://github.com/zwWangcn/summarize_youtube_plugin/issues) 联系开发者。

## English

### Overview

Video AI Summarizer extracts captions from YouTube pages and uses a third-party AI provider selected by the user to create summaries or caption translations. The extension does not operate a developer-controlled server that receives API keys, video transcripts, or AI output, and it does not sell user data.

### Data handled by the extension

- **API keys** supplied by the user for DeepSeek, OpenAI, Anthropic, Google Gemini, Moonshot, Alibaba Cloud Qwen, Zhipu GLM, or xAI.
- **Website content**, including the title, identifier, and transcript of a video the user chooses to process.
- **Settings**, including the selected provider, model, and output language.
- **Generated content**, including summaries and translated captions.

### Data storage

- API keys are stored on the current device in `chrome.storage.local` and are not placed in `chrome.storage.sync`.
- Non-sensitive provider, model, and language settings are stored in `chrome.storage.sync` and may sync between Chrome browsers when Chrome Sync is enabled.
- Summaries and translated captions are cached in `chrome.storage.local` for up to seven days with entry limits.
- Interface preferences are stored in `chrome.storage.local`.

### Data transfer and use

Only after the user explicitly requests a summary or translation, the selected video's transcript, generation request, and corresponding API key are sent over HTTPS directly to the AI provider selected by the user. That provider processes the data under its own terms and privacy policy.

The extension communicates directly with YouTube pages and endpoints to obtain information and available captions for the current video. To improve caption reliability, it locally observes caption responses made by the page; this observation does not itself send data to the developer or an AI provider. API keys, transcripts, and AI output are not sent to a server controlled by the extension developer.

### Data sharing

The developer does not sell, rent, or share user data except for communications with the video platform and AI provider required to fulfill an explicit user request. Data is not used for advertising, credit assessment, or purposes unrelated to the extension's single purpose.

The extension's use of information received from Chrome APIs adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use), including the Limited Use requirements.

### User controls and deletion

Users can delete all API keys stored on the current device from the extension popup. Uninstalling the extension removes its local data from that device; users may also clear extension data through Chrome. Data already received by an AI provider is subject to that provider's deletion controls.

### Security note

All external requests use HTTPS. API keys are stored using Chrome extension storage, which is not represented as an operating-system encrypted vault. Do not save keys on public or untrusted devices. A separate, revocable API key with appropriate spending limits is recommended.

### Contact

For privacy questions, contact the developer through the project's [GitHub Issues](https://github.com/zwWangcn/summarize_youtube_plugin/issues).
