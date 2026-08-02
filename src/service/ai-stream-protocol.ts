export const AI_STREAM_PORT = "vas-ai-stream";

export interface AIStreamRequest {
  type: "AI_STREAM_START";
  systemPrompt: string;
  userPrompt: string;
  options: {
    maxOutputTokens?: number;
    temperature?: number;
    disableThinking?: boolean;
    firstResponseTimeoutMs?: number;
    inactivityTimeoutMs?: number;
    maxRetries?: number;
  };
}

export type AIStreamEvent =
  | { type: "token"; token: string }
  | { type: "done" }
  | {
    type: "error";
    name: string;
    message: string;
    retryable?: boolean;
  };
