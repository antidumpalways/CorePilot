import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const path = resolve(process.cwd(), "../../packages/contracts/.env.deploy");
const line = readFileSync(path, "utf8").split(/\r?\n/)
  .find(value => value.startsWith("DEPLOYER_PRIVATE_KEY="));
const key = line?.slice("DEPLOYER_PRIVATE_KEY=".length).trim();
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("DEPLOYER_KEY_NOT_CONFIGURED");
const account = privateKeyToAccount(key as `0x${string}`);
const client = createPublicClient({ transport: http("https://testnet-rpc.elysium.kinetiq.xyz") });
const chainId = await client.getChainId();
if (chainId !== 99801) throw new Error("NOT_ELYSIUM_TESTNET");
const balance = await client.getBalance({ address: account.address });
process.stdout.write(`Testnet deployer public address=${account.address} gas balance=${formatEther(balance)} HYPE chainId=${chainId}\n`);
