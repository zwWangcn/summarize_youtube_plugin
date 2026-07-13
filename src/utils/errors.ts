/**
 * 用户友好的错误类型。
 *
 * 设计原则：
 * - `message` — 展示给用户的清晰中文提示，包含可操作的指引
 * - `code` — 错误码，仅输出到 Console 供开发者调试
 * - `detail` — 技术细节（HTTP 状态码、API 错误信息等），仅输出到 Console
 */

export class UserError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "UserError";
  }
}
