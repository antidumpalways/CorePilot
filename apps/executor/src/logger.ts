/** Remove known signing secrets before any executor diagnostic leaves the process. */
export function redactLogValue(value: unknown): string {
  let output = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  for (const key of ["EXECUTOR_PRIVATE_KEY", "ORACLE_SIGNER_PRIVATE_KEY", "HYPERCORE_TESTNET_AGENT_PRIVATE_KEY"]) {
    const secret = process.env[key];
    if (secret && secret.length >= 10) output = output.replaceAll(secret, "[REDACTED]");
  }
  return output.replace(/0x[0-9a-fA-F]{64}/g, "[REDACTED_HEX32]");
}

const safe = (args: unknown[]) => args.map(redactLogValue);
export const log = {
  info: (...args: unknown[]) => console.log("[executor]", ...safe(args)),
  warn: (...args: unknown[]) => console.warn("[executor]", ...safe(args)),
  error: (...args: unknown[]) => console.error("[executor]", ...safe(args)),
};
