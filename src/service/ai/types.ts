/**
 * AI 适配器公共类型。
 */

/** 构建 API 请求的输入参数 */
export interface AIRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  apiKey: string;
  baseURL: string;
  maxOutputTokens?: number;
  temperature?: number;
  disableThinking?: boolean;
}

/** 构建结果 */
export interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** 流式解析结果 — 单次 yield 的数据 */
export interface StreamChunk {
  /** 增量文本 token */
  token?: string;
  /** finish_reason（如果有的话） */
  finishReason?: string;
}

/** 供应商适配器接口 */
export interface ProviderAdapter {
  /** 将统一请求参数构建为具体的流式 HTTP 请求 */
  buildStreamRequest(params: AIRequest): BuiltRequest;
  /** 解析 SSE data chunk 为一个 StreamChunk，无文本则返回 null */
  parseStreamChunk(data: unknown): StreamChunk | null;
}
