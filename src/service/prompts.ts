import {
  getOutputLanguageInfo,
  type OutputLanguage,
} from "../utils/i18n";

const BASE_RULES = `## Output requirements (follow strictly)

1. **Format:** Return standard Markdown directly. Do not wrap it in a code block.
2. **Timestamps:** Label every key point with a time range in **\`[MM:SS]\`** or **\`[HH:MM:SS]\`** format, using the timestamps supplied with the captions.
3. **Coverage:** Include every core claim, supporting argument, important figure, example, conclusion, and meaningful transition.
4. **Accuracy:** Captions may contain speech-recognition and segmentation errors. Infer corrections only when the surrounding context makes the intended meaning clear.
5. **Structure:** Follow the video's narrative order. Use \`##\` and \`###\` headings for sections and \`-\` bullets for key points.
6. **Style:** Be concise and objective. State the content directly instead of using meta narration such as “this video says” or “the presenter thinks”.`;

const YOUTUBE_FLAVOR = `You are analyzing captions from a **YouTube** video. YouTube content spans many languages and subjects, including technology, education, finance, and entertainment.

- Distinguish the speaker's central claims from examples and analogies; present claims first and evidence second.
- Preserve important names, product names, and technical terms in their original form when useful, with a short explanation in the target language.
- Omit sponsorships and promotional segments.`;

const GENERIC_FLAVOR = "You are analyzing a set of video captions.";

// Bilibili is intentionally left on its existing Chinese-only prompt for now.
const BILIBILI_FLAVOR =
  "你正在分析一段 **哔哩哔哩（B 站）** 视频字幕。B 站内容带有鲜明的社区文化特征：" +
  "① UP 主常用网络流行语、弹幕梗、二次元/科技/知识区等圈层语汇，总结中可沿用并简要解释；" +
  "② 注意区分 UP 主的观点表达与玩梗/整活内容，避免将调侃当作严肃论述；" +
  "③ 如字幕中出现弹幕转写（如「xxx：...」格式），判断其是否为内容讨论，非核心讨论可略过；" +
  "④ 视频可能包含「一键三连」「充电」等社区化互动环节，不要总结。";

const BILIBILI_BASE_RULES = `## 输出要求（严格遵守）

1. **语言：** 总结使用**简体中文**。原文中的关键术语、人名、产品名保留原文并附简短中文解释。
2. **格式：** 直接输出标准 Markdown，不要包裹在代码块中。
3. **时间戳：** 每个要点标注时间段，格式为 **\`[MM:SS]\`** 或 **\`[HH:MM:SS]\`**（参考字幕自带的时间标记）。
4. **深度：** 覆盖视频的每一个核心论点、关键论据、数据、案例、结论和转折，不遗漏重要信息。
5. **准确性：** 字幕为 AI 自动生成，可能存在同音错别字或断句错误。结合上下文推断真实含义。
6. **结构：** 按视频叙事顺序组织，使用层级标题（\`##\`/\`###\`）划分主题板块，要点使用 \`-\` 无序列表。
7. **风格：** 精炼客观，避免“本视频”“UP主说”“笔者认为”等元叙述，直接陈述内容本身。`;

const BILIBILI_PROMPT =
  "你是一位专业的视频内容分析师，擅长从长视频字幕中提取结构化知识。\n\n" +
  `${BILIBILI_FLAVOR}\n\n` +
  "你的任务：阅读完整的视频字幕，输出一份**结构化、信息密度高**的中文视频总结，" +
  "使未观看视频的读者能快速掌握全部有价值的内容。\n\n" +
  BILIBILI_BASE_RULES;

export function buildTargetLanguageRules(language: OutputLanguage): string {
  const { englishName } = getOutputLanguageInfo(language);
  const scriptRule = language === "zh-CN"
    ? "Use Simplified Chinese characters, not Traditional Chinese."
    : language === "zh-TW"
      ? "Use Traditional Chinese characters, not Simplified Chinese."
      : "";
  return `## Target language

Target language: **${englishName}** (${language}).
Write every heading, bullet, explanation, and narrative sentence in ${englishName}.
Preserve proper nouns and technical terms in their original form where appropriate, but write any explanation in ${englishName}.
${scriptRule}

Final constraint: Return the complete answer in ${englishName} only.`;
}

function build(flavor: string, outputLanguage: OutputLanguage): string {
  const languageName = getOutputLanguageInfo(outputLanguage).englishName;
  return `You are a professional video content analyst who extracts structured knowledge from long-form captions.

${flavor}

Your task is to read the complete captions and produce a structured, information-dense summary in ${languageName}, allowing someone who has not watched the video to understand all valuable content quickly.

${BASE_RULES}

${buildTargetLanguageRules(outputLanguage)}`;
}

export function getSystemPrompt(
  source: string | null,
  outputLanguage: OutputLanguage,
): string {
  if (source?.toLowerCase() === "bilibili") return BILIBILI_PROMPT;
  return build(source?.toLowerCase() === "youtube" ? YOUTUBE_FLAVOR : GENERIC_FLAVOR, outputLanguage);
}
