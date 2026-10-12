// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StrategyRegistry} from "./StrategyRegistry.sol";
import {ExecutionReceiptRegistry} from "./ExecutionReceiptRegistry.sol";
import {IMarketDataReader} from "./interfaces/IMarketDataReader.sol";
import {IExecutionAdapter} from "./interfaces/IExecutionAdapter.sol";
import {CorePilotTypes} from "./libraries/CorePilotTypes.sol";

/// @title ExecutionController
/// @notice Gating contract for strategy executions. Validates on-chain constraints and only
///         forwards valid intents to the execution adapter. Invalid executions revert.
/// @dev Constraint enforcement is on Elysium. On HyperCore the order is carried out by the
///      bonded trade-only agent, so adherence is guaranteed economically (bond + slashing).
contract ExecutionController {
    StrategyRegistry public immutable registry;
    IMarketDataReader public marketData;
    IExecutionAdapter public adapter;
    ExecutionReceiptRegistry public immutable receipts;

    address public owner;
    address public executor;
    /// Max acceptable age of a market snapshot (ms).
    uint256 public maxMarketDataAgeMs = 60_000;

    event ExecutorSet(address indexed executor);
    event MaxMarketDataAgeSet(uint256 ms);
    event ExecutionAccepted(uint256 indexed strategyId, bytes32 executionId, uint256 notionalUsd);
    event ExecutionRejected(uint256 indexed strategyId, bytes32 reason);

    error NotOwner();
    error NotExecutor();
    error ExecutorNotBonded();
    error StrategyInactive();
    error StrategyExpired();
    error MarketNotAllowed();
    error NotionalExceeded();
    error LeverageExceeded();
    error SlippageExceeded();
    error InvalidMarketData();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert NotExecutor();
        _;
    }

    constructor(
        StrategyRegistry _registry,
        IMarketDataReader _marketData,
        IExecutionAdapter _adapter,
        ExecutionReceiptRegistry _receipts
    ) {
        registry = _registry;
        marketData = _marketData;
        adapter = _adapter;
        receipts = _receipts;
        owner = msg.sender;
    }

    function setExecutor(address _executor) external onlyOwner {
        executor = _executor;
        emit ExecutorSet(_executor);
    }

    function setAdapter(IExecutionAdapter _adapter) external onlyOwner {
        adapter = _adapter;
    }

    function setMarketData(IMarketDataReader _marketData) external onlyOwner {
        marketData = _marketData;
    }

    function setMaxMarketDataAge(uint256 ms) external onlyOwner {
        maxMarketDataAgeMs = ms;
        emit MaxMarketDataAgeSet(ms);
    }

    /// @notice Execute a strategy intent. Reverts if any constraint is violated.
    function execute(CorePilotTypes.ExecutionRequest calldata req)
        external
        onlyExecutor
        returns (bytes32 executionId)
    {
        if (!registry.staking().isExecutorBonded(msg.sender)) revert ExecutorNotBonded();

        StrategyRegistry.Strategy memory s = registry.getStrategy(req.strategyId);
        if (!s.active) revert StrategyInactive();
        if (block.timestamp >= s.expiry) revert StrategyExpired();
        if (req.market != s.market) revert MarketNotAllowed();
        if (req.notionalUsd > s.maxNotionalUsd) revert NotionalExceeded();
        if (req.leverageBps > s.maxLeverageBps) revert LeverageExceeded();
        if (req.slippageBps > s.maxSlippageBps) revert SlippageExceeded();

        (, , uint256 ts) = marketData.getMarketData(req.market);
        if (ts == 0 || block.timestamp * 1000 > ts + maxMarketDataAgeMs) revert InvalidMarketData();

        executionId = adapter.execute(req.strategyId, abi.encode(req));

        receipts.record(req.strategyId, executionId, req.notionalUsd, true, bytes32(0));
        emit ExecutionAccepted(req.strategyId, executionId, req.notionalUsd);
    }

    /// @notice Record a rejected attempt for observability (called after an off-chain revert
    ///         simulation). Does not revert so the receipt is always written.
    function recordRejection(uint256 strategyId, bytes32 reason) external onlyExecutor {
        receipts.record(strategyId, bytes32(0), 0, false, reason);
        emit ExecutionRejected(strategyId, reason);
    }
}
