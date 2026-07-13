# 🤖 Video AI Summarizer — Chrome Extension

> 🌐 [简体中文](README.md) | English

An AI-powered summarizer for YouTube / Bilibili videos. Extract captions with one click and stream structured summaries in Chinese. Supports **8 AI providers, 20+ models** with free switching.

## Why a Chrome Extension?

Traditional Python web services running in WSL / server environments are limited by YouTube's anti-scraping strategies (verification pages, IP bans, etc.). A Chrome extension runs in a **real browser environment**, parsing page data directly and bypassing anti-bot detection cleanly.

## Features

- ✅ **Free model switching** — Supports DeepSeek, OpenAI GPT, Anthropic Claude, Google Gemini, Moonshot Kimi, Tongyi Qwen, Zhipu GLM, xAI Grok, covering 20+ models, one-click switch in the popup
- ✅ **One-click AI summary** — Click the "AI Summary" button on the page to stream a structured Markdown summary
- ✅ **View raw captions** — Read the original AI captions with timestamp seeking
- ✅ **Real-time streaming render** — Token-level streaming output, generated character-by-character like ChatGPT
- ✅ **SPA navigation awareness** — Automatically detects video switches on YouTube / Bilibili SPA pages
- ✅ **Multi-language captions** — Intelligently picks the best language track (YouTube: ja > en > zh; Bilibili: zh > en)
- ✅ **Auto-translation fallback** — If the AI output isn't Chinese, a translation fallback is triggered automatically
- ✅ **Summary caching** — 7-day TTL, LRU eviction, no repeated AI calls for the same video
- ✅ **Shadow DOM isolation** — Injected UI styles are fully isolated from the page, no mutual interference

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Chrome Extension (MV3)                     │
│                                                              │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  Popup   │  │  Background  │  │   Content Scripts      │  │
│  │ Settings │  │  Service     │  │                       │  │
│  │          │  │  Worker      │  │ youtube.ts             │  │
│  │ Provider │  │ Lifecycle    │  │ bilibili.ts            │  │
│  │ Model    │  │ Msg routing  │  └───────────┬───────────┘  │
│  │ API Key  │  │ Interceptor  │              │              │
│  └──────────┘  └──────────────┘  ┌───────────┴───────────┐  │
│                                   │    shared.ts           │  │
│                                   │   shared main logic    │  │
│                                   └───────────┬───────────┘  │
│                          ┌───────────────────┼─────────┐    │
│                     ┌────▼────┐  ┌────────────▼──────┐│    │
│                     │Extractors│  │  Panel (Shadow    ││    │
│                     │ Captions │  │  DOM UI component ││    │
│                     └────┬─────┘  └────────┬──────────┘│    │
│                          │                 │            │    │
│                ┌─────────▼─────────┐  ┌────▼──────────┐│    │
│                │   AI service      │  │   Renderer     ││    │
│                │  ┌─────────────┐  │  │   Markdown     ││    │
│                │  │ Adapter layer│  │  │  streaming     ││    │
│                │  │ 3 API formats│  │  └───────────────┘│    │
│                │  │ 8 providers  │  │                   │    │
│                │  └─────────────┘  │                   │    │
│                └───────────────────┘                   │    │
└──────────────────────────────────────────────────────────────┘
```

## Multi-Model AI Architecture

The core highlight: a **Provider Adapter pattern** unifies three heterogeneous API formats, so the upper-layer call site is completely uniform.

### Adapter Pattern Design

```
summarizeTextStream(transcript, providerId, modelId)
  │
  ├── model-registry.ts  → look up ProviderInfo (baseURL, apiFormat)
  ├── service/ai.ts      → select adapter by apiFormat
  │
  ├── "openai-compat"        → openaiCompatAdapter  (OpenAI / DeepSeek / Kimi / Qwen / GLM / Grok)
  ├── "anthropic-messages"   → anthropicAdapter     (Claude)
  └── "gemini"               → geminiAdapter        (Gemini)
  │
  └── unified StreamChunk { token?, finishReason? } → AsyncGenerator<string>
```

### Three API Formats at a Glance

| API Format | Providers | Request | Auth Header | Streaming Event Format |
|----------|--------|---------|--------|-------------|
| `openai-compat` | OpenAI, DeepSeek, Kimi, Qwen, GLM, Grok | POST `/v1/chat/completions` | `Authorization: Bearer` | SSE `data: {"choices":[{"delta":{"content":"..."}}]}` |
| `anthropic-messages` | Anthropic Claude | POST `/v1/messages` | `x-api-key` | SSE `content_block_delta` / `message_delta` / `message_stop` |
| `gemini` | Google Gemini | POST `/models/{model}:streamGenerateContent?alt=sse&key=` | URL query `key` param | SSE `{"candidates":[{"content":{"parts":[{"text":"..."}]}}]}` |

### Adding a New Provider / Model

Only `src/service/model-registry.ts`'s `PROVIDERS` array needs editing:

```typescript
// If the API format matches an existing provider, just add a config entry:
{
  id: "new-provider",
  name: "New Provider",
  baseURL: "https://api.new-provider.com/v1",
  apiFormat: "openai-compat",  // reuse an existing adapter
  docsUrl: "https://...",
  iconLetter: "NP",
  models: [{ id: "model-id", name: "Model Name", ... }],
}
```

If the API format is entirely different, first create a new adapter implementing the `ProviderAdapter` interface (`service/ai/types.ts`), then register it in `model-registry.ts`.

## How It Works

### 1. Caption Extraction — Differentiated Strategies per Platform

#### YouTube — Three-Path Architecture

YouTube caption extraction tries three paths in priority order:

| Priority | Path | Principle | Timeout |
|--------|------|------|------|
| 1 | **Interceptor cache** | Service Worker injects into MAIN world, patches `fetch`/`XHR` to intercept the YouTube player's timedtext requests | 3s |
| 2 | **InnerTube ANDROID** | POST `youtubei/v1/player` with an ANDROID client context, bypassing the WEB POT restriction | — |
| 3 | **Direct fetch** | Extract the caption URL from `ytInitialPlayerResponse` and fetch directly (may return empty due to POT) | — |

**Path 1 (Interceptor)**: Patches `fetch`/`XMLHttpRequest` in the MAIN world. When the YouTube player issues a timedtext request (carrying a POT signature), the response is cached. It's passed back to the content script across the isolated-world boundary via a DOM `CustomEvent` (`vas-caption-captured`). This is the **fastest path**, but requires CC to be on and the player to issue the request.

**Path 2 (InnerTube ANDROID)**: Following `youtube-transcript-api`, it requests YouTube's internal API with an Android client identity — fully silent, no CC button, no player manipulation, no MAIN world injection.

**Path 3 (Direct fetch)**: Fallback.

Bilibili has no such multi-path — the browser automatically carries cookies, so it calls the `api.bilibili.com` API directly.

### 2. SPA Navigation Awareness

YouTube and Bilibili are both SPAs; switching videos doesn't trigger a full page load. The extension senses navigation via three-way interception:

| Method | Implementation |
|----------|------|
| `MutationObserver` | Watches the `<title>` element for changes |
| `history.pushState / replaceState` | Wraps the History API, detects URL changes after each call |
| `popstate` event | Listens for browser back/forward |

Behavior on video switch:
- Leaving a video page → destroy the panel
- Entering a new video → wait 800ms (for DOM render) → re-inject the panel
- Panel already exists → reset state + update title
- 1s / 3s / 6s recovery checks prevent the UI from being removed during YouTube's skeleton → real DOM swap

### 3. Smart Injection-Point Detection

Page DOM structure changes frequently as YouTube / Bilibili iterate, so a **multi-selector fallback strategy** is used:

```
YouTube: #title h1 → h1.ytd-watch-metadata → #movie_player → #columns → #primary-inner
Bilibili: .video-title → .video-info-title → h1[data-title] → #bilibiliPlayer → #bpx-player-container → #playerWrap
```

Combined with a `MutationObserver` + 500ms polling dual mechanism, it waits up to 20 seconds for the target element to be ready.

### 4. Shadow DOM Style Isolation

The injected panel is fully isolated from the page via **Shadow DOM**:

```typescript
container.attachShadow({ mode: "open" })
// styles.css injected inline (via Vite ?inline import)
// Page CSS can't pierce the Shadow boundary; panel styling is unaffected by the page theme
```

A dark-theme UI (`#1f2937` background + purple-blue gradient buttons) keeps a consistent look on any page.

### 5. AI Streaming

```
Caption text (truncated to 200K chars)
  → select provider adapter (openai-compat / anthropic-messages / gemini)
  → build streaming HTTP request (URL + Headers + Body vary by API format)
  → fetch() + ReadableStream + TextDecoder, parse SSE line by line
  → adapter.parseStreamChunk() extracts a unified StreamChunk
  → AsyncGenerator yields tokens one by one
  → frontend renderStreaming() renders char-by-char + parses Markdown
```

Safety and reliability mechanisms:
- **Content filter detection**: Captures content-filter signals and throws a dedicated error
- **Auto-translation fallback**: When the output's Chinese-character ratio is < 30%, a translation API is called automatically
- **Smart retry**: Up to 2 retries, exponential backoff, retries only on 5xx, no retry on 4xx
- **Local API key storage**: Stored via `chrome.storage.sync`, never sent through any server

### 6. Prompt Engineering

Each platform has a differentiated System Prompt, sharing BASE_RULES:

| Dimension | YouTube | Bilibili |
|------|---------|----------|
| Core focus | Multilingual terms, international topics | Community culture, internet slang, danmaku memes |
| Term handling | Keep original + Chinese explanation | Keep subculture vocabulary + brief explanation |
| Special recognition | Sponsored / promo segments | One-click triple-action, charging and other interactions |
| Content filtering | Distinguish opinion vs. example/analogy | Distinguish serious argument vs. memeposting |
| Danmaku handling | N/A | Recognize danmaku transcripts; non-core discussion can be skipped |

Shared base rules: Simplified Chinese, timestamp annotation, Markdown format, high information density, AI typo correction.

### 7. Summary Cache

- Storage backend: `chrome.storage.local` (single key `vas-summaries`)
- TTL: 7 days, lazy cleanup (checked on read)
- Capacity control: max 50 entries, LRU eviction of the oldest when exceeded
- UI shows cache time; users can click "Summarize again" to force a refresh

## Installation

### Build from source

```bash
# 1. Install dependencies
npm install

# 2. Build
npm run build

# 3. Load in Chrome
#    Open chrome://extensions
#    Enable "Developer mode"
#    Click "Load unpacked"
#    Select the dist/ directory
```

### Dev + Hot Reload

```bash
npm run dev
# Vite + CRXJS provides HMR; the extension auto-reloads after code changes
```

## Usage

### Configure the AI Provider and Model

1. Get an API key (pick any provider):
   - [DeepSeek](https://platform.deepseek.com/api_keys) — recommended for China users, fast and economical
   - [OpenAI](https://platform.openai.com/api-keys) — GPT-5 series
   - [Anthropic](https://console.anthropic.com/keys) — Claude series
   - [Google Gemini](https://aistudio.google.com/apikey) — ultra-long context
   - [Moonshot Kimi](https://platform.kimi.ai) — native Chinese optimization
   - [Tongyi Qwen](https://bailian.console.aliyun.com/#/api-key) — Alibaba Cloud
   - [Zhipu GLM](https://open.bigmodel.cn/usercenter/apikeys) — cost-effective Chinese
   - [xAI Grok](https://console.x.ai) — multilingual understanding
2. Click the extension icon in the Chrome toolbar
3. Select provider → select model → enter API key → save

### Summarize a Video

1. Open any YouTube or Bilibili video page
2. Find the **🤖 AI Summary** button next to the video title (auto-injected)
3. Click it — the panel slides in from the right
4. Click **AI Summary** — streams a structured summary in real time
5. Click **Raw Captions** — view the original captions (toggle timestamps)
6. Use **📋 Copy** to quickly copy content

## Tech Stack

| Layer | Choice |
|---|---|
| Extension framework | Chrome Extension Manifest V3 |
| Language | TypeScript (strict mode) |
| Build | Vite 6 + CRXJS |
| AI engine | DeepSeek V4 / GPT-5 / Claude Sonnet 5 / Gemini 2.5 / Kimi K2.6 / Qwen3 / GLM-5.2 / Grok 4.3 |
| API adaptation | Provider Adapter pattern (OpenAI-compat / Anthropic Messages / Gemini) |
| Markdown | marked.js + DOMPurify |
| Style isolation | Shadow DOM + CSS Custom Properties |
| Storage | chrome.storage.sync (settings) + chrome.storage.local (cache) |

## Project Structure

```
src/
├── manifest.json                     # MV3 config (permissions, hosts, content_scripts)
├── background/
│   └── service-worker.ts             # Lifecycle + message routing + interceptor injection
├── content/
│   ├── youtube.ts                    # YouTube entry (Extractor impl + interceptor install)
│   ├── bilibili.ts                   # Bilibili entry
│   ├── shared.ts                     # Shared logic: injection probing, SPA awareness, Panel lifecycle
│   ├── extractors/
│   │   ├── youtube.ts                # YouTube caption extraction (3 paths: interceptor / InnerTube / direct fetch)
│   │   ├── bilibili.ts               # Bilibili caption extraction (__INITIAL_STATE__ → API → JSON → text)
│   │   └── caption-interceptor.ts   # YouTube MAIN world fetch/XHR interceptor
│   └── ui/
│       ├── panel.ts                  # Panel component (Shadow DOM, state machine, injection)
│       ├── renderer.ts               # Markdown / streaming render (marked + DOMPurify)
│       └── styles.css                # Shadow DOM dark-theme styles
├── service/
│   ├── ai.ts                         # AI streaming entry: adapter dispatch, SSE parse, retry, translation fallback
│   ├── ai/
│   │   ├── types.ts                  # ProviderAdapter interface + shared types
│   │   ├── openai-compat.ts          # OpenAI-compatible format adapter
│   │   ├── anthropic.ts              # Anthropic Messages API adapter
│   │   └── gemini.ts                 # Google Gemini API adapter
│   ├── model-registry.ts             # Provider + model metadata registry (PROVIDERS array)
│   ├── prompts.ts                    # Prompt templates (YouTube / Bilibili differentiated strategies)
│   ├── summary-cache.ts              # chrome.storage.local persistence + LRU eviction
│   └── storage.ts                    # Chrome Storage wrapper
├── popup/
│   └── popup.html/css/ts             # Settings popup (provider → model → API key)
└── utils/
    └── text.ts                       # Text utils: time formatting, caption joining, timestamp toggle
```

## Design Highlights

1. **Provider Adapter architecture** — Three heterogeneous API formats unified into one interface, zero awareness in the upper layer. Adding a provider only requires registering a config, no business-logic changes
2. **Zero server cost** — Runs entirely in the browser, no backend needed; user API keys live in local Chrome Sync Storage
3. **Three-path YouTube caption extraction** — Interceptor cache (fast) + InnerTube ANDROID (reliable) + direct fetch (fallback), maximizing availability
4. **Native SPA awareness** — Via `history` API interception + `MutationObserver` + `popstate`, seamlessly adapts to YouTube / Bilibili single-page navigation
5. **Shadow DOM isolation** — Injected UI styles are fully isolated; the dark theme looks consistent on any page
6. **Streaming render** — Token-level output, UX close to ChatGPT
7. **Smart language fallback** — Auto-detects AI output language, triggers translation when not Chinese
8. **Platform-aware prompts** — YouTube and Bilibili use different prompt strategies, understanding each community's culture and content characteristics
9. **Summary cache** — 7-day TTL + LRU eviction, reducing repeated AI calls
10. **Browser-env advantage** — Bilibili API requests automatically carry the user's login cookies, no manual session credentials

## Comparison with the Old Project

| Feature | Old project (Python) | Chrome extension |
|---|---|---|
| Runtime | WSL / Docker | Browser |
| Anti-scraping | Depends on third-party libs | Native page parsing ✅ |
| Deployment | FastAPI + Celery + Redis | Pure client-side ✅ |
| API key | Server .env | Local storage (never sent to developers) ✅ |
| Bilibili login | Manual SESSDATA | Browser auto cookies ✅ |
| URL input | Manual paste | Auto page detection ✅ |
| Startup | docker compose up | Click a button ✅ |
| AI models | Single model | 8 providers, 20+ models, free switching ✅ |

## License

[MIT](LICENSE)
