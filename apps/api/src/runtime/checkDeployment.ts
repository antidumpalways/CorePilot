import "dotenv/config";
import { createPublicClient, http, isAddress, type Address } from "viem";
import { executionControllerAbi, executionReceiptRegistryAbi, feeModuleAbi,
  pilotStakingAbi, pilotTokenAbi, strategyRegistryAbi } from "@corepilot/sdk";

function configured(name: string): Address {
  const address = process.env[name];
  if (!address || !isAddress(address)) throw new Error(`${name}_MISSING`);
  return address;
}
const rpc = process.env.ELYSIUM_RPC_URL ?? "https://testnet-rpc.elysium.kinetiq.xyz";
const client = createPublicClient({ transport: http(rpc, { timeout: 10000 }) });
const pilot = configured("PILOT_TOKEN_ADDRESS");
const staking = configured("STAKING_ADDRESS");
const registry = configured("STRATEGY_REGISTRY_ADDRESS");
const controller = configured("EXECUTION_CONTROLLER_ADDRESS");
const oracle = configured("MARKET_DATA_ORACLE_ADDRESS");
const receipts = configured("RECEIPT_REGISTRY_ADDRESS");
const fees = configured("FEE_MODULE_ADDRESS");
const addresses = { pilot, staking, registry, controller, oracle, receipts, fees };
const chainId = await client.getChainId();
if (chainId !== 99801) throw new Error("ELYSiUM_CHAIN_MISMATCH");
const pause = () => new Promise(resolve => setTimeout(resolve, 1200));
for (const [name, address] of Object.entries(addresses)) {
  if (!await client.getBytecode({ address })) throw new Error(`${name.toUpperCase()}_BYTECODE_MISSING`);
  await pause();
}
async function paced<T>(read: () => Promise<T>): Promise<T> { const result = await read(); await pause(); return result; }
const symbol = await paced(() => client.readContract({ address: pilot, abi: pilotTokenAbi, functionName: "symbol" }));
const registryStaking = await paced(() => client.readContract({ address: registry, abi: strategyRegistryAbi, functionName: "staking" }));
const stakingRegistry = await paced(() => client.readContract({ address: staking, abi: pilotStakingAbi, functionName: "strategyRegistry" }));
const stakingPilot = await paced(() => client.readContract({ address: staking, abi: pilotStakingAbi, functionName: "pilot" }));
const controllerRegistry = await paced(() => client.readContract({ address: controller, abi: executionControllerAbi, functionName: "registry" }));
const controllerOracle = await paced(() => client.readContract({ address: controller, abi: executionControllerAbi, functionName: "marketData" }));
const controllerReceipts = await paced(() => client.readContract({ address: controller, abi: executionControllerAbi, functionName: "receipts" }));
const controllerAdapter = await paced(() => client.readContract({ address: controller, abi: executionControllerAbi, functionName: "adapter" }));
const receiptController = await paced(() => client.readContract({ address: receipts, abi: executionReceiptRegistryAbi, functionName: "controller" }));
const feePilot = await paced(() => client.readContract({ address: fees, abi: feeModuleAbi, functionName: "pilot" }));
const nextStrategyId = await paced(() => client.readContract({ address: registry, abi: strategyRegistryAbi, functionName: "nextStrategyId" }));
const same = (left: Address, right: Address) => left.toLowerCase() === right.toLowerCase();
const checks = { chainId, pilotSymbol: symbol, nextStrategyId: String(nextStrategyId),
  registryStaking: same(registryStaking, staking), stakingRegistry: same(stakingRegistry, registry),
  stakingPilot: same(stakingPilot, pilot), controllerRegistry: same(controllerRegistry, registry),
  controllerOracle: same(controllerOracle, oracle), controllerReceipts: same(controllerReceipts, receipts),
  adapterBytecode: Boolean(await client.getBytecode({ address: controllerAdapter })),
  receiptController: same(receiptController, controller), feePilot: same(feePilot, pilot) };
process.stdout.write(`${JSON.stringify(checks)}\n`);
if (Object.values(checks).some(value => value === false)) process.exitCode = 1;
