/**
 * 模型注册表 — 管理所有 AI 供应商和模型的元数据。
 * 添加新模型只需在此文件中追加配置即可。
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** API 格式分类 */
export type ApiFormat = "openai-compat" | "anthropic-messages" | "gemini";

/** 单个模型信息 */
export interface ModelInfo {
  id: string;              // API 调用时使用的 model ID
  name: string;            // 显示名称
  provider: string;        // 所属供应商 ID
  descriptionKey: string;  // 本地化简介消息键
  paramSize: string;       // 参数等级（如 "~2T MoE"、"355B"、"—" 未知）
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
  thinkingControl: "none" | "deepseek" | "qwen" | "openai" | "reasoning" | "glm" | "anthropic" | "gemini";
  minimumReasoningEffort?: "none" | "low";
  translationThinkingType?: "disabled" | "between_tools" | "adaptive";
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
        id: "deepseek-flash",
        name: "DeepSeek V4.1 Flash",
        provider: "deepseek",
        descriptionKey: "modelDescDeepseekV4Flash",
        paramSize: "—",
        contextWindow: 1_000_000,
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        provider: "deepseek",
        descriptionKey: "modelDescDeepseekV4",
        paramSize: "1.6T MoE / 49B active",
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
        id: "gpt-6.1-sol",
        name: "GPT-6.1 Sol",
        provider: "openai",
        descriptionKey: "modelDescGpt61Sol",
        paramSize: "—",
        contextWindow: 1_050_000,
      },
      {
        id: "gpt-6-luna",
        name: "GPT-6 Luna",
        provider: "openai",
        descriptionKey: "modelDescGpt6Luna",
        paramSize: "—",
        contextWindow: 1_050_000,
      },
      {
        id: "gpt-6-astra",
        name: "GPT-6 Astra",
        provider: "openai",
        descriptionKey: "modelDescGpt6Astra",
        paramSize: "—",
        contextWindow: 1_050_000,
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
        id: "claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        provider: "anthropic",
        descriptionKey: "modelDescClaudeSonnet",
        paramSize: "—",
        contextWindow: 1_000_000,
      },
      {
        id: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        provider: "anthropic",
        descriptionKey: "modelDescClaudeOpus",
        paramSize: "—",
        contextWindow: 1_000_000,
      },
      {
        id: "claude-haiku-5-5",
        name: "Claude Haiku 5.5",
        provider: "anthropic",
        descriptionKey: "modelDescClaudeHaiku",
        paramSize: "—",
        contextWindow: 1_000_000,
      },
      {
        id: "claude-fable-5-1",
        name: "Claude Fable 5.1",
        provider: "anthropic",
        descriptionKey: "modelDescClaudeFable",
        paramSize: "—",
        contextWindow: 1_000_000,
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
        id: "gemini-3.8-flash",
        name: "Gemini 3.8 Flash",
        provider: "gemini",
        descriptionKey: "modelDescGemini38Flash",
        paramSize: "—",
        contextWindow: 1_048_576,
      },
      {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro (Preview)",
        provider: "gemini",
        descriptionKey: "modelDescGemini31Pro",
        paramSize: "—",
        contextWindow: 1_048_576,
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
        id: "kimi-k3",
        name: "Kimi K3",
        provider: "moonshot",
        descriptionKey: "modelDescKimiK3",
        paramSize: "2.8T",
        contextWindow: 1_000_000,
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
        id: "qwen3.8-max",
        name: "Qwen3.8 Max",
        provider: "qwen",
        descriptionKey: "modelDescQwenMax",
        paramSize: "—",
        contextWindow: 1_000_000,
      },
      {
        id: "qwen3.7-plus",
        name: "Qwen3.7 Plus",
        provider: "qwen",
        descriptionKey: "modelDescQwenPlus",
        paramSize: "—",
        contextWindow: 1_000_000,
      },
      {
        id: "qwen3.8-flash",
        name: "Qwen3.8 Flash",
        provider: "qwen",
        descriptionKey: "modelDescQwenFlash",
        paramSize: "—",
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
        id: "glm-5.3",
        name: "GLM-5.3",
        provider: "zhipu",
        descriptionKey: "modelDescGlm53",
        paramSize: "744B",
        contextWindow: 1_000_000,
      },
      {
        id: "glm-5.3-flash",
        name: "GLM-5.3 Flash",
        provider: "zhipu",
        descriptionKey: "modelDescGlm53Flash",
        paramSize: "320B MoE / 18B active",
        contextWindow: 1_000_000,
      },
      {
        id: "glm-5.3-flashx",
        name: "GLM-5.3 FlashX",
        provider: "zhipu",
        descriptionKey: "modelDescGlm53FlashX",
        paramSize: "320B MoE / 18B active",
        contextWindow: 1_000_000,
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
        id: "grok-4.7",
        name: "Grok 4.7",
        provider: "grok",
        descriptionKey: "modelDescGrok4",
        paramSize: "—",
        contextWindow: 500_000,
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
  "deepseek-v4-flash": "deepseek-flash",
  "deepseek-v4-flash-vision-exp": "deepseek-flash",
  "deepseek-chat": "deepseek-flash",
  "deepseek-reasoner": "deepseek-flash",
  "kimi-k2.6-thinking": "kimi-k3",
  "kimi-k2.6": "kimi-k3",
  "kimi-k2.5": "kimi-k3",
  "grok-4.1-fast": "grok-4.7",
  "grok-4.3": "grok-4.7",
  "claude-sonnet-5-20250702": "claude-sonnet-5-5",
  "claude-sonnet-5": "claude-sonnet-5-5",
  "claude-opus-4-8-20250515": "claude-opus-5-5",
  "claude-opus-4-8": "claude-opus-5-5",
  "claude-opus-5": "claude-opus-5-5",
  "claude-haiku-4-5-20251001": "claude-haiku-5-5",
  "gpt-5": "gpt-6.1-sol",
  "gpt-5-mini": "gpt-6.1-sol",
  "gpt-5.6-sol": "gpt-6.1-sol",
  "gpt-5.6-terra": "gpt-6.1-sol",
  "gpt-5.6-luna": "gpt-6-luna",
  "gpt-4.1": "gpt-6-luna",
  "gemini-2.5-pro": "gemini-3.1-pro-preview",
  "gemini-2.5-flash": "gemini-3.8-flash",
  "gemini-2.5-flash-lite": "gemini-3.8-flash",
  "gemini-3.7-flash": "gemini-3.8-flash",
  "qwen3-max": "qwen3.8-max",
  "qwen3.5-plus": "qwen3.7-plus",
  "qwen3.7-flash": "qwen3.8-flash",
  "qwen3.5-flash": "qwen3.8-flash",
  "glm-5.2": "glm-5.3",
  "glm-4.5": "glm-5.3-flash",
  "glm-4.5-air": "glm-5.3-flash",
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
  const openAIReasoningModel = providerId === "openai";
  const kimiReasoningModel = providerId === "moonshot" && normalizedId === "kimi-k3";
  const glmReasoningModel = providerId === "zhipu" && normalizedId.startsWith("glm-5.3");
  return {
    supportsTemperature: !["anthropic", "openai", "gemini", "moonshot"].includes(providerId),
    maxOutputTokensField: providerId === "openai"
      ? "max_completion_tokens"
      : "max_tokens",
    thinkingControl: openAIReasoningModel
      ? "openai"
      : providerId === "deepseek"
      ? "deepseek"
      : kimiReasoningModel || providerId === "grok"
        ? "reasoning"
        : glmReasoningModel
        ? "glm"
        : providerId === "anthropic"
        ? "anthropic"
        : providerId === "gemini"
        ? "gemini"
        : providerId === "qwen"
        ? "qwen"
        : "none",
    instructionRole: providerId === "openai" ? "developer" : "system",
    minimumReasoningEffort: openAIReasoningModel
      ? normalizedId === "gpt-6-luna" ? "none" : "low"
      : kimiReasoningModel || glmReasoningModel || providerId === "grok"
      ? "low"
      : undefined,
    translationThinkingType: providerId === "anthropic"
      ? normalizedId === "claude-sonnet-5-5" ? "between_tools"
        : normalizedId === "claude-haiku-5-5" ? "disabled" : "adaptive"
      : undefined,
  };
}

/** 格式化上下文窗口为人类可读字符串 */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return m === 1 ? "1M" : `${m}M`;
  }
  return `${Math.round(tokens / 1000)}K`;
}
