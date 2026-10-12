export const log = {
  info: (...args: unknown[]) => console.log(`[executor]`, ...args),
  warn: (...args: unknown[]) => console.warn(`[executor]`, ...args),
  error: (...args: unknown[]) => console.error(`[executor]`, ...args),
};
