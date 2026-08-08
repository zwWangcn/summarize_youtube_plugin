# 🤖 Video AI Summarizer — Chrome Extension

> 🌐 [简体中文](README.md) | English

An AI-powered summarizer for YouTube videos. Extract captions with one click and stream structured summaries, with 8 AI providers and 20+ models to switch between.

## Features

- **Free model switching** — DeepSeek / OpenAI / Claude / Gemini / Kimi / Qwen / GLM / Grok, 20+ models, one-click switch in the popup
- **One-click AI summary** — streams a structured Markdown summary
- **Multilingual output** — summaries and caption translations support Chinese (Simplified and Traditional), English, Japanese, Korean, Spanish, French, and German
- **Localized UI** — follows Chrome in Simplified Chinese, Traditional Chinese, Japanese, Korean, or English, with English as the fallback
- **Raw captions** — click timestamps to seek
- **Section-based subtitle translation** — translates the current caption section or resumes the full transcript
- **Real-time streaming** — token-level, character-by-character output
- **SPA navigation awareness** — auto-detects video switches
- **Multi-language captions** — picks the best track (ja > en > zh)
- **Language-isolated cache** — each output language has its own 7-day cache with LRU eviction

## How It Works

### Multi-Model AI Architecture

A Provider Adapter pattern unifies three heterogeneous API formats behind a single upper-layer call:

| API format | Providers | Request | Auth |
|---|---|---|---|
| `openai-compat` | OpenAI / DeepSeek / Kimi / Qwen / GLM / Grok | POST `/v1/chat/completions` | `Authorization: Bearer` |
| `anthropic-messages` | Claude | POST `/v1/messages` | `x-api-key` |
| `gemini` | Gemini | POST `/models/{model}:streamGenerateContent` | URL `key` param |

Each adapter normalizes its streaming response into a unified `StreamChunk { token?, finishReason? }`. To add a provider, append a config to the `PROVIDERS` array in `src/service/model-registry.ts`; for a brand-new API format, implement the `ProviderAdapter` interface first (`src/service/ai/types.ts`).

### Caption Extraction

Three paths are tried in priority order:

1. **Interceptor cache** (3s timeout) — the Service Worker patches `fetch`/`XHR` in the MAIN world, intercepts the player's timedtext requests (carrying a POT signature), caches them, and passes them back across the isolated-world boundary via a DOM `CustomEvent`.
2. **InnerTube ANDROID** — POSTs `youtubei/v1/player` with an ANDROID client context, bypassing the WEB POT restriction — fully silent.
3. **Direct fetch** — extracts the caption URL from `ytInitialPlayerResponse` and fetches it directly — fallback.

### Subtitle Translation and Repair

Translation now lives inside **Raw Captions**. Captions are split by source character count, open near the current playback position, and load in either direction as you scroll. Scrolling never triggers an AI request. Translate the current section, retry one section, or use **Translate All** to fill only missing sections, then switch between Source and Translation views.

The extension sends timestamped captions together with surrounding context so the AI can turn broken fragments into natural sentences and estimate second-level start times. Translated sentences do not need to map one-to-one to the original fragments, and their timestamps remain clickable. Each completed section is cached for seven days by video, source language, target language, provider, and model, so full translation resumes after closing the panel. Captions already written in the selected target language do not trigger a translation request.

### UI and Output Language

The manifest, popup, and YouTube panel use Chrome's native i18n system and follow Chrome in Simplified Chinese, Traditional Chinese, Japanese, Korean, or English. Other Chrome UI languages fall back to English. **YouTube output language** is a separate popup setting: it is initialized from Chrome once, then remains fixed until the user changes it. Supported output languages are Simplified Chinese, Traditional Chinese, English, Japanese, Korean, Spanish, French, and German.

### SPA Navigation Awareness

YouTube SPA navigation is sensed three ways: a `MutationObserver` on `<title>`, wrapped `history.pushState`/`replaceState`, and the `popstate` event. On video switch the old panel is destroyed and re-injected after 800ms, with 1s/3s/6s recovery checks for the skeleton → real DOM swap.

### Shadow DOM Isolation

The panel is injected into `<body>` (`position: fixed`) via Shadow DOM, fully isolating its styles from the page. The dark theme stays consistent across pages.

### AI Streaming

`fetch` + `ReadableStream` parses SSE line by line → `adapter.parseStreamChunk()` extracts tokens → `AsyncGenerator` yields them one by one.

- Content-filter signals are normalized into `ContentFilteredError`
- An English modular system prompt adds a controlled target-language constraint
- Retries only on 5xx and network errors (max 2, exponential backoff); no retry on 4xx
- API keys stay in `chrome.storage.local` on the current device; requests go directly to the selected AI provider and never through a developer-controlled server

### Summary Cache

`chrome.storage.local`, 7-day TTL with lazy cleanup, max 50 entries, LRU eviction when exceeded. Summary and caption-translation cache identities include the target language, so results are never reused across languages.

## Usage

### Install

```bash
npm install
npm run build
```

Open `chrome://extensions` → enable "Developer mode" → "Load unpacked" → select the `dist/` directory.

Dev hot-reload: `npm run dev`

### Configure

1. Get an API key (any one provider):
   - [DeepSeek](https://platform.deepseek.com/api_keys)
   - [OpenAI](https://platform.openai.com/api-keys)
   - [Anthropic](https://console.anthropic.com/keys)
   - [Google Gemini](https://aistudio.google.com/apikey)
   - [Moonshot Kimi](https://platform.kimi.ai)
   - [Tongyi Qwen](https://bailian.console.aliyun.com/#/api-key)
   - [Zhipu GLM](https://open.bigmodel.cn/usercenter/apikeys)
   - [xAI Grok](https://console.x.ai)
2. Click the extension icon → pick a provider, model, and YouTube output language → enter the API key → save

### Summarize a Video

1. Open a YouTube video page
2. Click the **🤖 AI Summary** button next to the title
3. The panel slides in from the right; click **AI Summary** to stream
4. Click **Raw Captions** to view the original captions (click timestamps to seek)
5. When the caption language differs from the output language, use **Translate Section** or **Translate All** inside the captions view

## License

[MIT](LICENSE)

## Privacy

See the [Privacy Policy](PRIVACY.md).
