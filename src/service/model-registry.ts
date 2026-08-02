/**
 * 模型注册表 — 管理所有 AI 供应商和模型的元数据。
 * 添加新模型只需在此文件中追加配置即可。
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** API 格式分类 */
export type ApiFormat = "openai-compat" | "anthropic-messages" | "gemini";

/** 定价货币 */
export type Currency = "USD" | "CNY";

/** 每百万 token 定价 */
export interface Pricing {
  input: number;       // 输入价格 per 1M tokens
  output: number;      // 输出价格 per 1M tokens
  currency: Currency;
}

/** 单个模型信息 */
export interface ModelInfo {
  id: string;              // API 调用时使用的 model ID
  name: string;            // 显示名称
  provider: string;        // 所属供应商 ID
  description: string;     // 一句话简介
  paramSize: string;       // 参数等级（如 "~2T MoE"、"355B"、"—" 未知）
  pricing: Pricing;        // 每百万 token 价格
  contextWindow: number;   // 上下文窗口大小（tokens）
}

/** 供应商信息 */
export interface ProviderInfo {
  id: string;
  name: string;               // 显示名称
  baseURL: string;            // API 根地址
  apiFormat: ApiFormat;       // API 格式
  docsUrl: string;            // 获取 API Key 的文档链接
  iconLetter: string;         // UI 中显示的缩写字母（1-2 字符）
  models: ModelInfo[];
}

// ---------------------------------------------------------------------------
// Providers & Models
// ---------------------------------------------------------------------------

export const PROVIDERS: ProviderInfo[] = [
  // ---- DeepSeek ----
  {
    id: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    apiFormat: "openai-compat",
    docsUrl: "https://platform.deepseek.com/api_keys",
    iconLetter: "DS",
    models: [
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        provider: "deepseek",
        description: "V4 Flash 0731，快速经济，推荐日常使用",
        paramSize: "284B MoE / 13B active",
        pricing: { input: 0.14, output: 0.28, currency: "USD" },
        contextWindow: 1_000_000,
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        provider: "deepseek",
        description: "更强推理，适合复杂内容",
        paramSize: "1.6T MoE / 49B active",
        pricing: { input: 0.435, output: 0.87, currency: "USD" },
        contextWindow: 1_000_000,
      },
    ],
  },

  // ---- OpenAI GPT ----
  {
    id: "openai",
    name: "OpenAI GPT",
    baseURL: "https://api.openai.com/v1",
    apiFormat: "openai-compat",
    docsUrl: "https://platform.openai.com/api-keys",
    iconLetter: "GP",
    models: [
      {
        id: "gpt-5",
        name: "GPT-5",
        provider: "openai",
        description: "旗舰模型，最强理解力",
        paramSize: "~2T MoE",
        pricing: { input: 1.25, output: 10.00, currency: "USD" },
        contextWindow: 200_000,
      },
      {
        id: "gpt-5-mini",
        name: "GPT-5 Mini",
        provider: "openai",
        description: "快速经济，适合日常总结",
        paramSize: "~200B",
        pricing: { input: 0.25, output: 2.00, currency: "USD" },
        contextWindow: 128_000,
      },
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        provider: "openai",
        description: "超长上下文，适合超长视频",
        paramSize: "~1.7T",
        pricing: { input: 2.00, output: 8.00, currency: "USD" },
        contextWindow: 1_000_000,
      },
    ],
  },

  // ---- Anthropic Claude ----
  {
    id: "anthropic",
    name: "Anthropic Claude",
    baseURL: "https://api.anthropic.com/v1",
    apiFormat: "anthropic-messages",
    docsUrl: "https://console.anthropic.com/keys",
    iconLetter: "CL",
    models: [
      {
        id: "claude-sonnet-5-20250702",
        name: "Claude Sonnet 5",
        provider: "anthropic",
        description: "最佳性价比，代理能力强",
        paramSize: "—",
        pricing: { input: 2.00, output: 10.00, currency: "USD" },
        contextWindow: 1_000_000,
      },
      {
        id: "claude-opus-4-8-20250515",
        name: "Claude Opus 4.8",
        provider: "anthropic",
        description: "最强质量，深度分析长视频",
        paramSize: "—",
        pricing: { input: 5.00, output: 25.00, currency: "USD" },
        contextWindow: 200_000,
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        provider: "anthropic",
        description: "极速经济，简明快速总结",
        paramSize: "—",
        pricing: { input: 0.80, output: 4.00, currency: "USD" },
        contextWindow: 200_000,
      },
    ],
  },

  // ---- Google Gemini ----
  {
    id: "gemini",
    name: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    apiFormat: "gemini",
    docsUrl: "https://aistudio.google.com/apikey",
    iconLetter: "GE",
    models: [
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        provider: "gemini",
        description: "旗舰推理，深度分析复杂内容",
        paramSize: "—",
        pricing: { input: 1.25, output: 10.00, currency: "USD" },
        contextWindow: 1_000_000,
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        provider: "gemini",
        description: "高速均衡，推荐首选",
        paramSize: "—",
        pricing: { input: 0.30, output: 2.50, currency: "USD" },
        contextWindow: 1_000_000,
      },
      {
        id: "gemini-2.5-flash-lite",
        name: "Gemini 2.5 Flash Lite",
        provider: "gemini",
        description: "极致低价，快速浏览场景",
        paramSize: "—",
        pricing: { input: 0.10, output: 0.40, currency: "USD" },
        contextWindow: 1_000_000,
      },
    ],
  },

  // ---- Moonshot Kimi（月之暗面）----
  {
    id: "moonshot",
    name: "Moonshot Kimi",
    baseURL: "https://api.moonshot.ai/v1",
    apiFormat: "openai-compat",
    docsUrl: "https://platform.kimi.ai",
    iconLetter: "KI",
    models: [
      {
        id: "kimi-k2.6",
        name: "Kimi K2.6",
        provider: "moonshot",
        description: "旗舰通用，中文原生优化",
        paramSize: "~1T MoE",
        pricing: { input: 6.50, output: 27.00, currency: "CNY" },
        contextWindow: 128_000,
      },
      {
        id: "kimi-k2.6-thinking",
        name: "Kimi K2.6 Thinking",
        provider: "moonshot",
        description: "深度推理模式，复杂内容分析",
        paramSize: "~1T MoE",
        pricing: { input: 6.50, output: 27.00, currency: "CNY" },
        contextWindow: 128_000,
      },
      {
        id: "kimi-k2.5",
        name: "Kimi K2.5",
        provider: "moonshot",
        description: "经济选择，性价比之选",
        paramSize: "~1T MoE",
        pricing: { input: 4.00, output: 21.00, currency: "CNY" },
        contextWindow: 128_000,
      },
    ],
  },

  // ---- 阿里通义千问 Qwen ----
  {
    id: "qwen",
    name: "通义千问 Qwen",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiFormat: "openai-compat",
    docsUrl: "https://bailian.console.aliyun.com/#/api-key",
    iconLetter: "QW",
    models: [
      {
        id: "qwen3-max",
        name: "Qwen3 Max",
        provider: "qwen",
        description: "旗舰模型，复杂内容深度总结",
        paramSize: "—",
        pricing: { input: 1.20, output: 6.00, currency: "USD" },
        contextWindow: 252_000,
      },
      {
        id: "qwen3.5-plus",
        name: "Qwen3.5 Plus",
        provider: "qwen",
        description: "均衡性价比，1M 超长上下文",
        paramSize: "—",
        pricing: { input: 0.40, output: 2.40, currency: "USD" },
        contextWindow: 1_000_000,
      },
      {
        id: "qwen3.5-flash",
        name: "Qwen3.5 Flash",
        provider: "qwen",
        description: "极速低价，日常快速总结",
        paramSize: "—",
        pricing: { input: 0.10, output: 0.40, currency: "USD" },
        contextWindow: 1_000_000,
      },
    ],
  },

  // ---- 智谱 GLM ----
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    apiFormat: "openai-compat",
    docsUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    iconLetter: "GL",
    models: [
      {
        id: "glm-5.2",
        name: "GLM-5.2",
        provider: "zhipu",
        description: "最新旗舰，深度推理",
        paramSize: "744B",
        pricing: { input: 4.00, output: 18.00, currency: "CNY" },
        contextWindow: 128_000,
      },
      {
        id: "glm-4.5",
        name: "GLM-4.5",
        provider: "zhipu",
        description: "高性价比，中文字幕总结首选",
        paramSize: "355B(A) MoE",
        pricing: { input: 2.00, output: 8.00, currency: "CNY" },
        contextWindow: 128_000,
      },
      {
        id: "glm-4.5-air",
        name: "GLM-4.5 Air",
        provider: "zhipu",
        description: "轻量极速，快速浏览总结",
        paramSize: "106B(A) MoE",
        pricing: { input: 0.80, output: 2.00, currency: "CNY" },
        contextWindow: 128_000,
      },
    ],
  },

  // ---- xAI Grok ----
  {
    id: "grok",
    name: "xAI Grok",
    baseURL: "https://api.x.ai/v1",
    apiFormat: "openai-compat",
    docsUrl: "https://console.x.ai",
    iconLetter: "GR",
    models: [
      {
        id: "grok-4.3",
        name: "Grok 4.3",
        provider: "grok",
        description: "旗舰模型，多语言理解优秀",
        paramSize: "—",
        pricing: { input: 1.25, output: 2.50, currency: "USD" },
        contextWindow: 1_000_000,
      },
      {
        id: "grok-4.1-fast",
        name: "Grok 4.1 Fast",
        provider: "grok",
        description: "极速低价，2M 超长上下文",
        paramSize: "—",
        pricing: { input: 0.20, output: 0.50, currency: "USD" },
        contextWindow: 2_000_000,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// 查询辅助函数
// ---------------------------------------------------------------------------

/** 根据 ID 获取供应商信息 */
export function getProvider(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

const ALL_MODELS = PROVIDERS.flatMap((p) => p.models);

/** 根据 ID 获取单个模型信息（跨所有供应商） */
export function getModel(id: string): ModelInfo | undefined {
  return ALL_MODELS.find((m) => m.id === id);
}

/** 获取某个供应商下的所有模型 */
export function getModelsByProvider(providerId: string): ModelInfo[] {
  const provider = getProvider(providerId);
  return provider?.models ?? [];
}

/** 格式化价格字符串（用于 UI 显示） */
export function formatPricing(p: Pricing): string {
  if (p.currency === "CNY") {
    return `¥${p.input}/¥${p.output}`;
  }
  return `$${p.input}/$${p.output}`;
}

/** 格式化上下文窗口为人类可读字符串 */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return m === 1 ? "1M" : `${m}M`;
  }
  return `${Math.round(tokens / 1000)}K`;
}
