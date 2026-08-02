export type SummaryCacheOperation = "read" | "write" | "invalidation";

/**
 * 总结缓存是可选能力：存储故障必须被消费，不能阻断字幕提取或 AI 总结。
 */
export async function runSummaryCacheOperation<T>(
  operation: SummaryCacheOperation,
  task: () => Promise<T>,
  onFailure: (error: unknown) => void,
): Promise<T | undefined> {
  try {
    return await task();
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.debug(`[vas] Summary cache ${operation} failed:`, detail);
    onFailure(error);
    return undefined;
  }
}
