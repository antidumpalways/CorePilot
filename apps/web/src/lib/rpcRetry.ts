export function isRpcRateLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /rate limit exceeded|too many requests|\b429\b/i.test(message);
}

/** Bounded retry for read-only RPC calls; never retry signed transactions. */
export async function retryRpcRead<T>(read: () => Promise<T>,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await read(); }
    catch (error) {
      if (!isRpcRateLimit(error) || attempt === 2) throw error;
      await wait(1500 * (attempt + 1));
    }
  }
  throw new Error("RPC_RETRY_EXHAUSTED");
}
