import { parseAbi } from "viem";

/**
 * Human-readable ABIs. Kept here (rather than generated) so the SDK has no build step and
 * stays aligned with the contracts in `packages/contracts`.
 */

export const pilotTokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function faucet()",
  "function mint(address to, uint256 amount)",
]);

export const pilotStakingAbi = parseAbi([
  "function CREATOR_MIN_BOND() view returns (uint256)",
  "function EXECUTOR_MIN_BOND() view returns (uint256)",
  "function creatorBonds(uint256 strategyId) view returns (uint256 amount, uint256 unlockAt)",
  "function executorBonds(address executor) view returns (uint256 amount, uint256 unlockAt)",
  "function isCreatorBonded(uint256 strategyId) view returns (bool)",
  "function isExecutorBonded(address executor) view returns (bool)",
  "function stakeCreator(uint256 strategyId, uint256 amount)",
  "function requestUnstakeCreator(uint256 strategyId)",
  "function unstakeCreator(uint256 strategyId)",
  "function stakeExecutor(uint256 amount)",
  "function requestUnstakeExecutor()",
  "function unstakeExecutor()",
]);

export const strategyRegistryAbi = parseAbi([
  "function nextStrategyId() view returns (uint256)",
  "function staking() view returns (address)",
  "function getStrategy(uint256 strategyId) view returns ((address, bytes32, bytes32, uint256, uint256, uint256, uint256, bool))",
  "function isExecutable(uint256 strategyId) view returns (bool)",
  "function createStrategy(bytes32 market, bytes32 strategyType, uint256 maxLeverageBps, uint256 maxSlippageBps, uint256 maxNotionalUsd, uint256 expiry) returns (uint256)",
  "function updateStrategy(uint256 strategyId, uint256 maxLeverageBps, uint256 maxSlippageBps, uint256 maxNotionalUsd, uint256 expiry)",
  "function setActive(uint256 strategyId, bool active)",
  "event StrategyCreated(uint256 indexed strategyId, address indexed creator, bytes32 market)",
]);

export const executionControllerAbi = parseAbi([
  "function executor() view returns (address)",
  "function maxMarketDataAgeMs() view returns (uint256)",
  "function execute((uint256 strategyId, bytes32 market, bool isLong, uint256 notionalUsd, uint256 leverageBps, uint256 slippageBps) req) returns (bytes32)",
  "function recordRejection(uint256 strategyId, bytes32 reason)",
  "event ExecutionAccepted(uint256 indexed strategyId, bytes32 executionId, uint256 notionalUsd)",
  "event ExecutionRejected(uint256 indexed strategyId, bytes32 reason)",
]);

export const marketDataOracleAbi = parseAbi([
  "function signer() view returns (address)",
  "function getMarketData(bytes32 market) view returns (uint256 markPriceUSD, int256 fundingRateBps, uint256 timestampMs)",
  "function digest(bytes32 market, uint256 markPriceUSD, int256 fundingRateBps, uint256 timestampMs) view returns (bytes32)",
  "function submit(bytes32 market, uint256 markPriceUSD, int256 fundingRateBps, uint256 timestampMs, bytes signature)",
  "function forceData(bytes32 market, uint256 markPriceUSD, int256 fundingRateBps, uint256 timestampMs)",
]);

export const feeModuleAbi = parseAbi([
  "function charge(uint256 strategyId, address payer, address asset, uint256 amount, address creator, address executor) returns (uint256, uint256, uint256, uint256)",
  "function setSplit(uint256 creatorBps, uint256 executorBps, uint256 treasuryBps, uint256 buybackBps)",
  "event FeeCharged(uint256 indexed strategyId, address indexed payer, address asset, uint256 amount, uint256 creatorPaid, uint256 executorPaid, uint256 treasuryPaid, uint256 buybackPaid)",
]);
