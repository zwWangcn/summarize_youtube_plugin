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
  descriptionKey: string;  // 本地化简介消息键
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

export interface AIRequestProfile {
  supportsTemperature: boolean;
  maxOutputTokensField: "max_tokens" | "max_completion_tokens";
  thinkingControl: "none" | "deepseek" | "qwen" | "openai";
  instructionRole: "system" | "developer";
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
        descriptionKey: "modelDescDeepseekV4Flash",
        paramSize: "284B MoE / 13B active",
        pricing: { input: 0.14, output: 0.28, currency: "USD" },
        contextWindow: 1_000_000,
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        provider: "deepseek",
        descriptionKey: "modelDescDeepseekV4",
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
        descriptionKey: "modelDescGpt5",
        paramSize: "~2T MoE",
        pricing: { input: 1.25, output: 10.00, currency: "USD" },
        contextWindow: 400_000,
      },
      {
        id: "gpt-5-mini",
        name: "GPT-5 Mini",
        provider: "openai",
        descriptionKey: "modelDescGpt5Mini",
        paramSize: "~200B",
        pricing: { input: 0.25, output: 2.00, currency: "USD" },
        contextWindow: 400_000,
      },
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        provider: "openai",
        descriptionKey: "modelDescGpt41",
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
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        provider: "anthropic",
        descriptionKey: "modelDescClaudeSonnet",
        paramSize: "—",
        pricing: { input: 2.00, output: 10.00, currency: "USD" },
        contextWindow: 1_000_000,
      },
      {
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        provider: "anthropic",
        descriptionKey: "modelDescClaudeOpus",
        paramSize: "—",
        pricing: { input: 5.00, output: 25.00, currency: "USD" },
        contextWindow: 200_000,
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        provider: "anthropic",
        descriptionKey: "modelDescClaudeHaiku",
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
        descriptionKey: "modelDescGemini25Pro",
        paramSize: "—",
        pricing: { input: 1.25, output: 10.00, currency: "USD" },
        contextWindow: 1_000_000,
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        provider: "gemini",
        descriptionKey: "modelDescGemini25Flash",
        paramSize: "—",
        pricing: { input: 0.30, output: 2.50, currency: "USD" },
        contextWindow: 1_000_000,
      },
      {
        id: "gemini-2.5-flash-lite",
        name: "Gemini 2.5 Flash Lite",
        provider: "gemini",
        descriptionKey: "modelDescGemini25FlashLite",
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
        descriptionKey: "modelDescKimiK2",
        paramSize: "~1T MoE",
        pricing: { input: 6.50, output: 27.00, currency: "CNY" },
        contextWindow: 128_000,
      },
      {
        id: "kimi-k2.6-thinking",
        name: "Kimi K2.6 Thinking",
        provider: "moonshot",
        descriptionKey: "modelDescKimiThinking",
        paramSize: "~1T MoE",
        pricing: { input: 6.50, output: 27.00, currency: "CNY" },
        contextWindow: 128_000,
      },
      {
        id: "kimi-k2.5",
        name: "Kimi K2.5",
        provider: "moonshot",
        descriptionKey: "modelDescKimiTurbo",
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
        descriptionKey: "modelDescQwenMax",
        paramSize: "—",
        pricing: { input: 1.20, output: 6.00, currency: "USD" },
        contextWindow: 252_000,
      },
      {
        id: "qwen3.5-plus",
        name: "Qwen3.5 Plus",
        provider: "qwen",
        descriptionKey: "modelDescQwenPlus",
        paramSize: "—",
        pricing: { input: 0.40, output: 2.40, currency: "USD" },
        contextWindow: 1_000_000,
      },
      {
        id: "qwen3.5-flash",
        name: "Qwen3.5 Flash",
        provider: "qwen",
        descriptionKey: "modelDescQwenFlash",
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
        descriptionKey: "modelDescGlm47",
        paramSize: "744B",
        pricing: { input: 4.00, output: 18.00, currency: "CNY" },
        contextWindow: 128_000,
      },
      {
        id: "glm-4.5",
        name: "GLM-4.5",
        provider: "zhipu",
        descriptionKey: "modelDescGlm45",
        paramSize: "355B(A) MoE",
        pricing: { input: 2.00, output: 8.00, currency: "CNY" },
        contextWindow: 128_000,
      },
      {
        id: "glm-4.5-air",
        name: "GLM-4.5 Air",
        provider: "zhipu",
        descriptionKey: "modelDescGlm45Air",
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
        descriptionKey: "modelDescGrok4",
        paramSize: "—",
        pricing: { input: 1.25, output: 2.50, currency: "USD" },
        contextWindow: 1_000_000,
      },
      {
        id: "grok-4.1-fast",
        name: "Grok 4.1 Fast",
        provider: "grok",
        descriptionKey: "modelDescGrok4Fast",
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

/** 获取某个供应商下的所有模型 */
export function getModelsByProvider(providerId: string): ModelInfo[] {
  const provider = getProvider(providerId);
  return provider?.models ?? [];
}

const LEGACY_MODEL_IDS: Record<string, string> = {
  "claude-sonnet-5-20250702": "claude-sonnet-5",
  "claude-opus-4-8-20250515": "claude-opus-4-8",
};

/** 将曾经发布过的错误/旧模型 ID 归一化，避免升级后破坏已保存设置。 */
export function normalizeModelId(modelId: string): string {
  return LEGACY_MODEL_IDS[modelId] ?? modelId;
}

/** 只在模型确实属于指定供应商时返回，防止 provider/model 状态串线。 */
export function getModelForProvider(
  providerId: string,
  modelId: string,
): ModelInfo | undefined {
  const normalizedId = normalizeModelId(modelId);
  return getProvider(providerId)?.models.find((model) => model.id === normalizedId);
}

/** 将持久化的 provider/model 组合归一化为注册表中的有效组合。 */
export function resolveAISelection(
  providerId: string | undefined,
  modelId: string | undefined,
): { provider: ProviderInfo; model: ModelInfo } {
  const provider = getProvider(providerId || "deepseek") ?? PROVIDERS[0];
  const model = getModelForProvider(provider.id, modelId || "") ?? provider.models[0];
  return { provider, model };
}

/** 不同“兼容 API”之间仍有差异；在注册表旁集中声明请求能力。 */
export function getAIRequestProfile(
  providerId: string,
  modelId: string,
): AIRequestProfile {
  const normalizedId = normalizeModelId(modelId);
  const rejectsSamplingParameters = providerId === "anthropic" && (
    normalizedId === "claude-sonnet-5" || normalizedId === "claude-opus-4-8"
  );
  const openAIReasoningModel = providerId === "openai" && (
    normalizedId === "gpt-5" || normalizedId === "gpt-5-mini"
  );
  return {
    supportsTemperature: !rejectsSamplingParameters && !openAIReasoningModel,
    maxOutputTokensField: providerId === "openai"
      ? "max_completion_tokens"
      : "max_tokens",
    thinkingControl: openAIReasoningModel
      ? "openai"
      : providerId === "deepseek"
      ? "deepseek"
      : providerId === "qwen"
        ? "qwen"
        : "none",
    instructionRole: providerId === "openai" ? "developer" : "system",
  };
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
