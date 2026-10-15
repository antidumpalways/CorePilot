// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";

interface IStrategyCreatorRegistry {
    function creatorOf(uint256 strategyId) external view returns (address);
}

/// @title PilotStaking
/// @notice Creator bond + executor bond with a withdrawal cooldown.
/// @dev Bonds are economic accountability for the *service provider*, not trading capital
///      capacity. Exposure is decided by the user authorization + strategy constraints.
///
///      Slashing philosophy: do NOT slash for market losses. Only objectively provable
///      violations should ever be slashable. In the MVP we only emit a violation event and
///      keep bond accounting; no subjective administrator slashing.
contract PilotStaking {
    IERC20 public immutable pilot;

    uint256 public constant CREATOR_MIN_BOND = 5_000e18;
    uint256 public constant EXECUTOR_MIN_BOND = 5_000e18;
    uint256 public constant COOLDOWN = 1 days;

    struct Bond {
        uint256 amount;
        uint256 unlockAt; // 0 == no pending unstake
    }

    /// strategyId => creator bond
    mapping(uint256 => Bond) public creatorBonds;
    /// executor => bond
    mapping(address => Bond) public executorBonds;

    address public owner;
    IStrategyCreatorRegistry public strategyRegistry;

    event CreatorStaked(uint256 indexed strategyId, address indexed creator, uint256 amount);
    event CreatorUnstakeRequested(uint256 indexed strategyId, uint256 unlockAt);
    event CreatorUnstaked(uint256 indexed strategyId, address indexed creator, uint256 amount);
    event ExecutorStaked(address indexed executor, uint256 amount);
    event ExecutorUnstakeRequested(address indexed executor, uint256 unlockAt);
    event ExecutorUnstaked(address indexed executor, uint256 amount);
    event ViolationRecorded(bytes32 indexed kind, uint256 indexed strategyId, address subject);

    error NotOwner();
    error NoBond();
    error CooldownActive(uint256 unlockAt);
    error BondBelowMinimum();
    error StrategyRegistryAlreadySet();
    error StrategyRegistryNotSet();
    error NotStrategyCreator();
    error InvalidRegistry();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IERC20 _pilot) {
        pilot = _pilot;
        owner = msg.sender;
    }

    /// @notice Bind once to the registry that owns strategy identities. Configure before
    ///         accepting creator bonds; a bond cannot be claimed by an arbitrary staker.
    function setStrategyRegistry(address _registry) external onlyOwner {
        if (address(strategyRegistry) != address(0)) revert StrategyRegistryAlreadySet();
        if (_registry.code.length == 0) revert InvalidRegistry();
        strategyRegistry = IStrategyCreatorRegistry(_registry);
    }

    modifier onlyStrategyCreator(uint256 strategyId) {
        if (address(strategyRegistry) == address(0)) revert StrategyRegistryNotSet();
        if (strategyRegistry.creatorOf(strategyId) != msg.sender) revert NotStrategyCreator();
        _;
    }

    // ---- Creator bonds -------------------------------------------------------

    function stakeCreator(uint256 strategyId, uint256 amount) external onlyStrategyCreator(strategyId) {
        require(pilot.transferFrom(msg.sender, address(this), amount), "transfer failed");
        Bond storage b = creatorBonds[strategyId];
        b.amount += amount;
        b.unlockAt = 0;
        emit CreatorStaked(strategyId, msg.sender, amount);
    }

    function requestUnstakeCreator(uint256 strategyId) external onlyStrategyCreator(strategyId) {
        Bond storage b = creatorBonds[strategyId];
        if (b.amount == 0) revert NoBond();
        b.unlockAt = block.timestamp + COOLDOWN;
        emit CreatorUnstakeRequested(strategyId, b.unlockAt);
    }

    function unstakeCreator(uint256 strategyId) external onlyStrategyCreator(strategyId) {
        Bond storage b = creatorBonds[strategyId];
        if (b.amount == 0) revert NoBond();
        if (b.unlockAt == 0 || block.timestamp < b.unlockAt) revert CooldownActive(b.unlockAt);
        uint256 amount = b.amount;
        b.amount = 0;
        b.unlockAt = 0;
        require(pilot.transfer(msg.sender, amount), "transfer failed");
        emit CreatorUnstaked(strategyId, msg.sender, amount);
    }

    function isCreatorBonded(uint256 strategyId) public view returns (bool) {
        return creatorBonds[strategyId].amount >= CREATOR_MIN_BOND;
    }

    // ---- Executor bonds ------------------------------------------------------

    function stakeExecutor(uint256 amount) external {
        require(pilot.transferFrom(msg.sender, address(this), amount), "transfer failed");
        Bond storage b = executorBonds[msg.sender];
        b.amount += amount;
        b.unlockAt = 0;
        emit ExecutorStaked(msg.sender, amount);
    }

    function requestUnstakeExecutor() external {
        Bond storage b = executorBonds[msg.sender];
        if (b.amount == 0) revert NoBond();
        b.unlockAt = block.timestamp + COOLDOWN;
        emit ExecutorUnstakeRequested(msg.sender, b.unlockAt);
    }

    function unstakeExecutor() external {
        Bond storage b = executorBonds[msg.sender];
        if (b.amount == 0) revert NoBond();
        if (b.unlockAt == 0 || block.timestamp < b.unlockAt) revert CooldownActive(b.unlockAt);
        uint256 amount = b.amount;
        b.amount = 0;
        b.unlockAt = 0;
        require(pilot.transfer(msg.sender, amount), "transfer failed");
        emit ExecutorUnstaked(msg.sender, amount);
    }

    function isExecutorBonded(address executor) public view returns (bool) {
        return executorBonds[executor].amount >= EXECUTOR_MIN_BOND;
    }

    // ---- Violation architecture (MVP: event only) ----------------------------

    /// @notice Records an *objectively provable* violation. MVP does not slash; this only
    ///         emits an event so a future verifier can act. Never call for market losses.
    function recordViolation(bytes32 kind, uint256 strategyId, address subject) external onlyOwner {
        emit ViolationRecorded(kind, strategyId, subject);
    }
}
