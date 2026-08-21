# Chrome Web Store visual prompts

Originally composed with the built-in `imagegen` workflow from real extension screenshots in `assets/`. Images 01–02 were later revised with deterministic raster compositing from `assets/new/` so their product UI and marketing text remain exact pixels. Both localized versions of image 03 were regenerated directly from the complete back-view subtitle capture to preserve natural head, neck, body, and arm continuity.

## Feature screenshots

- `01-ai-summary-1280x800.png`: “长视频，一眼掌握” — AI structured summaries with timestamp navigation.
- `02-transcript-translation-1280x800.png`: “逐段翻译，定位原文” — section/full transcript translation and timestamps.
- `03-bilingual-subtitles-1280x800.png`: “双语字幕，同步播放” — synchronized source and translated subtitles.
- `04-multilanguage-1280x800.png`: “多语言，按你习惯输出” — independent UI and output-language controls, with Chinese, English, Japanese, and Korean cues.
- `05-multimodel-1280x800.png`: “连接你常用的 AI 模型” — provider/model selection with DeepSeek, OpenAI, Claude, Gemini, Kimi, Qwen, GLM, and Grok.

All feature images use a charcoal/deep-burgundy/coral visual system, exact supplied copy, square outer corners, readable thumbnail hierarchy, no invented claims, and preservation of the recognizable product UI. Images 01–03 now use a real blackboard teaching frame in which the lecturer is shown only from behind; no face or identifiable personal features are visible. Both versions of image 03 use the full source composition rather than a localized person/background replacement; the English version pairs the preserved English source subtitle with a Spanish translation.

## Promotional images

- `promo-small-440x280.png`: brand-first tile using the exact icon and copy “AI 总结与翻译 / 多模型 / 多语言”.
- `promo-marquee-1400x560.png`: wide product banner using the exact icon and copy “看懂每一段视频 / AI 总结 · 双语字幕 · 多模型 · 多语言”.

The promotional prompts prohibited third-party logos, provider logos, fake ratings/badges, pricing claims, and watermarks.

## English localization

The English counterparts are stored in `assets/store-listing/en/`. They use the same compositions with localized marketing copy:

- “Understand Long Videos at a Glance”
- “Translate by Section, Find the Source”
- “Bilingual Subtitles, In Sync”
- “Output in Your Language”
- “Use the AI Models You Prefer”
- Small tile: “AI Summary & Translation / Multi-model / Multilingual”
- Marquee: “Understand Every Video / AI summaries · Bilingual subtitles · Multi-model · Multilingual”

Localization preserves the layout, icon, lecture context, product hierarchy, provider names, model names, timestamps, and numbers. The Chinese and English versions of images 01–03 share the same non-identifiable back-view teaching frame while retaining their original localized UI and subtitle layers. The final multi-model image reuses the already validated provider-chip region so `Qwen` remains exact. `promo-marquee-1400x560-v2.png` is the selected English marquee; it retains the full source width and adds matching vertical background instead of cropping the edge content.

The superseded face-forward versions are retained under `archive/with-lecturer/`, and the discarded composited Chinese image 03 is retained under `archive/back-view-composite/`. Neither archive is referenced by a README.
