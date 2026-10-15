import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const root = resolve(process.cwd(), "../..");
const apiPath = resolve(root, "apps/api/.env");
const executorPath = resolve(root, "apps/executor/.env");
if (!apiPath.startsWith(root) || !executorPath.startsWith(root)) throw new Error("WORKSPACE_PATH_INVALID");

function value(content: string, key: string): string | null {
  const line = content.split(/\r?\n/).find(item => item.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : null;
}
function put(content: string, key: string, next: string): string {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex(line => line.startsWith(`${key}=`));
  if (index >= 0) {
    if (lines[index].slice(key.length + 1).trim() && lines[index] !== `${key}=${next}`) {
      throw new Error(`${key} is already configured differently; refusing to overwrite it`);
    }
    lines[index] = `${key}=${next}`;
  } else lines.push(`${key}=${next}`);
  return lines.join("\n").replace(/\n*$/, "\n");
}

let api = readFileSync(apiPath, "utf8");
let executor = readFileSync(executorPath, "utf8");
const dbUrl = value(api, "DATABASE_URL");
if (!dbUrl?.startsWith("postgresql://corepilot:")) throw new Error("LOCAL_DATABASE_URL_MISSING");

const executorKey = value(executor, "EXECUTOR_PRIVATE_KEY");
if (executorKey && /^0x[0-9a-fA-F]{64}$/.test(executorKey)) {
  const executorAddress = privateKeyToAccount(executorKey as `0x${string}`).address;
  api = put(api, "EXECUTOR_ADDRESS", executorAddress);
  api = put(api, "WATCHER_ENABLED", "true");
  api = put(api, "WATCHER_POLL_MS", "15000");
  api = put(api, "RUNTIME_ORDER_NOTIONAL_USD", "12");
  api = put(api, "RUNTIME_LEVERAGE_BPS", "100");
  api = put(api, "RUNTIME_SLIPPAGE_BPS", "50");
  writeFileSync(apiPath, api, "utf8");
  process.stdout.write(`Elysium executor public address: ${executorAddress}\n`);
} else process.stdout.write("Elysium executor key unavailable; watcher will remain disabled.\n");

const existingAgentKey = value(executor, "HYPERCORE_TESTNET_AGENT_PRIVATE_KEY");
const agentKey = existingAgentKey || generatePrivateKey();
if (!/^0x[0-9a-fA-F]{64}$/.test(agentKey)) throw new Error("AGENT_KEY_INVALID");
executor = put(executor, "DATABASE_URL", dbUrl);
executor = put(executor, "HYPERCORE_TESTNET_AGENT_PRIVATE_KEY", agentKey);
executor = put(executor, "EXECUTOR_ENABLE_TESTNET_ORDERS", "false");
writeFileSync(executorPath, executor, "utf8");
process.stdout.write(`HyperCore TESTNET agent public address: ${privateKeyToAccount(agentKey as `0x${string}`).address}\n`);
process.stdout.write("Agent key stored only in ignored apps/executor/.env; order worker remains disabled.\n");
