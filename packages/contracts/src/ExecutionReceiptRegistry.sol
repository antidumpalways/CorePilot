// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ExecutionReceiptRegistry
/// @notice Stores essential data/hashes for each execution attempt (accepted or rejected).
/// @dev Full details live off-chain; on-chain we store the minimum.
contract ExecutionReceiptRegistry {
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
    uint256 public nextReceiptId = 1;

    event ReceiptRecorded(
        uint256 indexed receiptId,
        uint256 indexed strategyId,
        bytes32 executionId,
        bool accepted,
        bytes32 reason
    );
    event ControllerSet(address indexed controller);

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

    function record(
        uint256 strategyId,
        bytes32 executionId,
        uint256 notionalUsd,
        bool accepted,
        bytes32 reason
    ) external onlyController returns (uint256 receiptId) {
        receiptId = nextReceiptId++;
        receipts[receiptId] = Receipt({
            strategyId: strategyId,
            executionId: executionId,
            notionalUsd: notionalUsd,
            accepted: accepted,
            reason: reason,
            timestamp: block.timestamp,
            executor: tx.origin
        });
        emit ReceiptRecorded(receiptId, strategyId, executionId, accepted, reason);
    }
}
