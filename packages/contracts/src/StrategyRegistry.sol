// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PilotStaking} from "./PilotStaking.sol";

/// @title StrategyRegistry
/// @notice Stores strategy identity and hard execution bounds. Signal matching and policy
///         decisions are made off-chain; `strategyType` is metadata, not on-chain verification.
contract StrategyRegistry {
    struct Strategy {
        address creator;
        bytes32 market;
        bytes32 strategyType;
        uint256 maxLeverageBps;
        uint256 maxSlippageBps;
        uint256 maxNotionalUsd;
        uint256 expiry;
        bool active;
    }

    PilotStaking public staking;

    mapping(uint256 => Strategy) internal _strategies;
    uint256 public nextStrategyId = 1;

    address public owner;

    event StrategyCreated(uint256 indexed strategyId, address indexed creator, bytes32 market);
    event StrategyUpdated(uint256 indexed strategyId);
    event StrategyActiveSet(uint256 indexed strategyId, bool active);

    error NotOwner();
    error NotCreator();
    error UnknownStrategy();
    error InvalidParams();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(PilotStaking _staking) {
        staking = _staking;
        owner = msg.sender;
    }

    function setStaking(PilotStaking _staking) external onlyOwner {
        staking = _staking;
    }

    function createStrategy(
        bytes32 market,
        bytes32 strategyType,
        uint256 maxLeverageBps,
        uint256 maxSlippageBps,
        uint256 maxNotionalUsd,
        uint256 expiry
    ) external returns (uint256 strategyId) {
        if (maxNotionalUsd == 0 || maxLeverageBps == 0 || expiry <= block.timestamp) {
            revert InvalidParams();
        }
        strategyId = nextStrategyId++;
        _strategies[strategyId] = Strategy({
            creator: msg.sender,
            market: market,
            strategyType: strategyType,
            maxLeverageBps: maxLeverageBps,
            maxSlippageBps: maxSlippageBps,
            maxNotionalUsd: maxNotionalUsd,
            expiry: expiry,
            active: false
        });
        emit StrategyCreated(strategyId, msg.sender, market);
    }

    function updateStrategy(
        uint256 strategyId,
        uint256 maxLeverageBps,
        uint256 maxSlippageBps,
        uint256 maxNotionalUsd,
        uint256 expiry
    ) external {
        Strategy storage s = _strategies[strategyId];
        if (s.creator == address(0)) revert UnknownStrategy();
        if (msg.sender != s.creator) revert NotCreator();
        if (maxNotionalUsd == 0 || maxLeverageBps == 0 || expiry <= block.timestamp) {
            revert InvalidParams();
        }
        s.maxLeverageBps = maxLeverageBps;
        s.maxSlippageBps = maxSlippageBps;
        s.maxNotionalUsd = maxNotionalUsd;
        s.expiry = expiry;
        emit StrategyUpdated(strategyId);
    }

    /// @notice Activate/deactivate a strategy. Activation requires the creator to be bonded.
    function setActive(uint256 strategyId, bool active) external {
        Strategy storage s = _strategies[strategyId];
        if (s.creator == address(0)) revert UnknownStrategy();
        if (msg.sender != s.creator) revert NotCreator();
        if (active && !staking.isCreatorBonded(strategyId)) revert InvalidParams();
        s.active = active;
        emit StrategyActiveSet(strategyId, active);
    }

    /// @notice Canonical creator authority used by PilotStaking for all creator-bond operations.
    function creatorOf(uint256 strategyId) external view returns (address) {
        address creator = _strategies[strategyId].creator;
        if (creator == address(0)) revert UnknownStrategy();
        return creator;
    }

    function getStrategy(uint256 strategyId) external view returns (Strategy memory) {
        Strategy memory s = _strategies[strategyId];
        if (s.creator == address(0)) revert UnknownStrategy();
        return s;
    }

    /// @notice True when the strategy exists, is active, is not expired, and the creator is bonded.
    function isExecutable(uint256 strategyId) external view returns (bool) {
        Strategy storage s = _strategies[strategyId];
        if (s.creator == address(0)) return false;
        return s.active && block.timestamp < s.expiry && staking.isCreatorBonded(strategyId);
    }
}
