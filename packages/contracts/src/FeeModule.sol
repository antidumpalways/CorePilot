// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";

/// @title FeeModule
/// @notice Charges the CorePilot service fee and splits it between creator, executor,
///         treasury, and the PILOT buyback/burn vault.
/// @dev Fee is denominated in USD but settled in a chosen asset (USDC or PILOT). The caller
///      (backend/executor) converts and applies any PILOT discount off-chain; on-chain this
///      contract only moves the provided amount per the configured split.
contract FeeModule {
    IERC20 public immutable usdc;
    IERC20 public immutable pilot;

    uint256 public creatorBps;
    uint256 public executorBps;
    uint256 public treasuryBps;
    uint256 public buybackBps;

    address public treasury;
    address public buybackVault;
    address public owner;

    event FeeCharged(
        uint256 indexed strategyId,
        address indexed payer,
        address asset,
        uint256 amount,
        uint256 creatorPaid,
        uint256 executorPaid,
        uint256 treasuryPaid,
        uint256 buybackPaid
    );
    event SplitSet(uint256 creatorBps, uint256 executorBps, uint256 treasuryBps, uint256 buybackBps);
    event AddressesSet(address treasury, address buybackVault);

    error NotOwner();
    error BadSplit();
    error NotSupportedAsset();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        IERC20 _usdc,
        IERC20 _pilot,
        address _treasury,
        address _buybackVault,
        uint256 _creatorBps,
        uint256 _executorBps,
        uint256 _treasuryBps,
        uint256 _buybackBps
    ) {
        usdc = _usdc;
        pilot = _pilot;
        treasury = _treasury;
        buybackVault = _buybackVault;
        _setSplit(_creatorBps, _executorBps, _treasuryBps, _buybackBps);
        owner = msg.sender;
    }

    function setSplit(
        uint256 _creatorBps,
        uint256 _executorBps,
        uint256 _treasuryBps,
        uint256 _buybackBps
    ) external onlyOwner {
        _setSplit(_creatorBps, _executorBps, _treasuryBps, _buybackBps);
    }

    function setAddresses(address _treasury, address _buybackVault) external onlyOwner {
        treasury = _treasury;
        buybackVault = _buybackVault;
        emit AddressesSet(_treasury, _buybackVault);
    }

    /// @notice Charge a fee in `asset` (USDC or PILOT) from `payer` and distribute it.
    /// @param asset either `usdc` or `pilot`
    function charge(
        uint256 strategyId,
        address payer,
        address asset,
        uint256 amount,
        address creator,
        address executor
    ) external returns (uint256 creatorPaid, uint256 executorPaid, uint256 treasuryPaid, uint256 buybackPaid) {
        if (asset != address(usdc) && asset != address(pilot)) revert NotSupportedAsset();
        IERC20 token = IERC20(asset);
        require(token.transferFrom(payer, address(this), amount), "fee transfer failed");

        creatorPaid = (amount * creatorBps) / 10_000;
        executorPaid = (amount * executorBps) / 10_000;
        treasuryPaid = (amount * treasuryBps) / 10_000;
        buybackPaid = amount - creatorPaid - executorPaid - treasuryPaid;

        if (creatorPaid > 0) require(token.transfer(creator, creatorPaid), "creator pay failed");
        if (executorPaid > 0) require(token.transfer(executor, executorPaid), "executor pay failed");
        if (treasuryPaid > 0) require(token.transfer(treasury, treasuryPaid), "treasury pay failed");
        if (buybackPaid > 0) require(token.transfer(buybackVault, buybackPaid), "buyback pay failed");

        emit FeeCharged(
            strategyId, payer, asset, amount, creatorPaid, executorPaid, treasuryPaid, buybackPaid
        );
    }

    function _setSplit(
        uint256 _creatorBps,
        uint256 _executorBps,
        uint256 _treasuryBps,
        uint256 _buybackBps
    ) internal {
        if (_creatorBps + _executorBps + _treasuryBps + _buybackBps != 10_000) revert BadSplit();
        creatorBps = _creatorBps;
        executorBps = _executorBps;
        treasuryBps = _treasuryBps;
        buybackBps = _buybackBps;
        emit SplitSet(_creatorBps, _executorBps, _treasuryBps, _buybackBps);
    }
}
