// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StrategyRegistry} from "./StrategyRegistry.sol";
import {ExecutionReceiptRegistry} from "./ExecutionReceiptRegistry.sol";
import {IMarketDataReader} from "./interfaces/IMarketDataReader.sol";
import {IExecutionAdapter} from "./interfaces/IExecutionAdapter.sol";
import {CorePilotTypes} from "./libraries/CorePilotTypes.sol";

/// @title ExecutionController
/// @notice Checks hard execution bounds and dispatches an off-chain-approved intent to an adapter.
/// @dev Funding signal/policy matching is NOT verified here. An adapter response is a request id,
///      not proof of a HyperCore order or fill. No automatic slashing or venue enforcement exists.
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
    /// @dev Legacy event name: "accepted" means adapter request accepted, not venue executed.
    event ExecutionAccepted(uint256 indexed strategyId, bytes32 executionId, uint256 notionalUsd);
    /// @dev Legacy event name: the reason is reported by the executor, not verified here.
    event ExecutionRejected(uint256 indexed strategyId, bytes32 reason);
    event AdapterRequestAccepted(uint256 indexed strategyId, bytes32 indexed requestId, uint256 notionalUsd);
    event ExecutorRejectionReported(uint256 indexed strategyId, bytes32 reason);

    error NotOwner();
    error NotExecutor();
    error ExecutorNotBonded();
    error CreatorNotBonded();
    error StrategyInactive();
    error StrategyExpired();
    error MarketNotAllowed();
    error NotionalExceeded();
    error LeverageExceeded();
    error SlippageExceeded();
    error InvalidMarketData();
    error InvalidExecutionRequest();
    error InvalidAdapterRequestId();

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

    /// @notice Dispatch a policy-approved intent after on-chain hard-bound checks.
    /// @dev The caller is responsible for off-chain signal/policy evaluation. A successful return
    ///      means the adapter accepted the request, never that a venue filled an order.
    function execute(CorePilotTypes.ExecutionRequest calldata req)
        external
        onlyExecutor
        returns (bytes32 executionId)
    {
        if (!registry.staking().isExecutorBonded(msg.sender)) revert ExecutorNotBonded();

        StrategyRegistry.Strategy memory s = registry.getStrategy(req.strategyId);
        if (!s.active) revert StrategyInactive();
        if (block.timestamp >= s.expiry) revert StrategyExpired();
        if (!registry.staking().isCreatorBonded(req.strategyId)) revert CreatorNotBonded();
        if (req.notionalUsd == 0 || req.leverageBps == 0) revert InvalidExecutionRequest();
        if (req.market != s.market) revert MarketNotAllowed();
        if (req.notionalUsd > s.maxNotionalUsd) revert NotionalExceeded();
        if (req.leverageBps > s.maxLeverageBps) revert LeverageExceeded();
        if (req.slippageBps > s.maxSlippageBps) revert SlippageExceeded();

        (, , uint256 ts) = marketData.getMarketData(req.market);
        uint256 nowMs = block.timestamp * 1000;
        if (ts == 0 || ts > nowMs || nowMs - ts > maxMarketDataAgeMs) revert InvalidMarketData();

        executionId = adapter.execute(req.strategyId, abi.encode(req));
        if (executionId == bytes32(0)) revert InvalidAdapterRequestId();

        receipts.recordForExecutor(req.strategyId, executionId, req.notionalUsd, true, bytes32(0), msg.sender);
        emit ExecutionAccepted(req.strategyId, executionId, req.notionalUsd);
        emit AdapterRequestAccepted(req.strategyId, executionId, req.notionalUsd);
    }

    /// @notice Record an executor-reported rejection for observability. This is not an on-chain
    ///         proof of a policy denial or of which hard constraint failed.
    function recordRejection(uint256 strategyId, bytes32 reason) external onlyExecutor {
        receipts.recordForExecutor(strategyId, bytes32(0), 0, false, reason, msg.sender);
        emit ExecutionRejected(strategyId, reason);
        emit ExecutorRejectionReported(strategyId, reason);
    }
}
