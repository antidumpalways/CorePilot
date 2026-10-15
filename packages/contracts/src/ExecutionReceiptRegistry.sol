// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ExecutionReceiptRegistry
/// @notice Stores adapter requests and executor-reported rejections, never venue-fill proofs.
/// @dev `accepted` in the legacy Receipt ABI means accepted for adapter dispatch only.
///      `reason` for a rejection is supplied by the executor and is not independently verified.
contract ExecutionReceiptRegistry {
    enum ReceiptStatus { NONE, ADAPTER_REQUESTED, EXECUTOR_REJECTION_REPORTED }

    struct Receipt {
        uint256 strategyId;
        bytes32 executionId;
        uint256 notionalUsd;
        bool accepted;
        bytes32 reason;
        uint256 timestamp;
        address executor;
    }

    address public controller;
    address public owner;
    mapping(uint256 => Receipt) public receipts;
    mapping(uint256 => ReceiptStatus) public receiptStatus;
    uint256 public nextReceiptId = 1;

    /// @dev Legacy event: accepted means adapter dispatch; reason is executor-reported.
    event ReceiptRecorded(
        uint256 indexed receiptId,
        uint256 indexed strategyId,
        bytes32 executionId,
        bool accepted,
        bytes32 reason
    );
    event ControllerSet(address indexed controller);
    event ReceiptStatusRecorded(uint256 indexed receiptId, ReceiptStatus status, address indexed executor);

    error NotOwner();
    error NotController();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setController(address _controller) external onlyOwner {
        controller = _controller;
        emit ControllerSet(_controller);
    }

    /// @notice Legacy controller entry point. `executor` is tx.origin here; new integrations
    ///         should use recordForExecutor for the actual authorized executor address.
    function record(
        uint256 strategyId,
        bytes32 executionId,
        uint256 notionalUsd,
        bool accepted,
        bytes32 reason
    ) external onlyController returns (uint256 receiptId) {
        return _record(strategyId, executionId, notionalUsd, accepted, reason, tx.origin);
    }

    function recordForExecutor(
        uint256 strategyId,
        bytes32 executionId,
        uint256 notionalUsd,
        bool accepted,
        bytes32 reason,
        address executor
    ) external onlyController returns (uint256 receiptId) {
        return _record(strategyId, executionId, notionalUsd, accepted, reason, executor);
    }

    function _record(
        uint256 strategyId,
        bytes32 executionId,
        uint256 notionalUsd,
        bool accepted,
        bytes32 reason,
        address executor
    ) internal returns (uint256 receiptId) {
        receiptId = nextReceiptId++;
        receipts[receiptId] = Receipt({
            strategyId: strategyId,
            executionId: executionId,
            notionalUsd: notionalUsd,
            accepted: accepted,
            reason: reason,
            timestamp: block.timestamp,
            executor: executor
        });
        ReceiptStatus status = accepted
            ? ReceiptStatus.ADAPTER_REQUESTED
            : ReceiptStatus.EXECUTOR_REJECTION_REPORTED;
        receiptStatus[receiptId] = status;
        emit ReceiptRecorded(receiptId, strategyId, executionId, accepted, reason);
        emit ReceiptStatusRecorded(receiptId, status, executor);
    }
}
