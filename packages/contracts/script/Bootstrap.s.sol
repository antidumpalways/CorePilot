// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PilotToken} from "../src/PilotToken.sol";
import {PilotStaking} from "../src/PilotStaking.sol";
import {StrategyRegistry} from "../src/StrategyRegistry.sol";
import {ExecutionController} from "../src/ExecutionController.sol";
import {SignedMarketDataOracle} from "../src/oracle/SignedMarketDataOracle.sol";

/// @notice Sets up a working demo state after `Deploy.s.sol`, for a single-account local/testnet
///         flow where the deployer acts as creator + executor.
/// Usage:
///   forge script script/Bootstrap.s.sol:Bootstrap \
///     --rpc-url $ELYSIUM_RPC_URL --broadcast
/// Requires env (printed by Deploy.s.sol):
///   PILOT_TOKEN_ADDRESS STAKING_ADDRESS STRATEGY_REGISTRY_ADDRESS
///   EXECUTION_CONTROLLER_ADDRESS MARKET_DATA_ORACLE_ADDRESS
contract Bootstrap is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address me = vm.addr(pk);

        PilotToken pilot = PilotToken(vm.envAddress("PILOT_TOKEN_ADDRESS"));
        PilotStaking staking = PilotStaking(vm.envAddress("STAKING_ADDRESS"));
        StrategyRegistry registry = StrategyRegistry(vm.envAddress("STRATEGY_REGISTRY_ADDRESS"));
        ExecutionController controller =
            ExecutionController(vm.envAddress("EXECUTION_CONTROLLER_ADDRESS"));
        SignedMarketDataOracle oracle =
            SignedMarketDataOracle(vm.envAddress("MARKET_DATA_ORACLE_ADDRESS"));

        vm.startBroadcast(pk);

        // Fund the deployer with test PILOT and approve staking.
        pilot.mint(me, 200_000e18);
        pilot.approve(address(staking), type(uint256).max);

        // Create the flagship strategy: HYPE funding trigger, bounded constraints.
        uint256 id = registry.createStrategy(
            bytes32("HYPE"),
            bytes32("FUNDING_TRIGGER"),
            300, // max leverage 3x
            50, // max slippage 0.50%
            25_000, // max notional $25k
            block.timestamp + 7 days
        );

        // Creator bond -> activate; executor bond -> become executor.
        staking.stakeCreator(id, 5_000e18);
        registry.setActive(id, true);
        staking.stakeExecutor(5_000e18);
        controller.setExecutor(me);

        // Seed oracle data so an execution can pass the freshness check.
        oracle.forceData(bytes32("HYPE"), 46_20 * 1e6, -1, block.timestamp * 1000);

        vm.stopBroadcast();

        console2.log("strategyId:", id);
        console2.log("executor (deployer):", me);
        console2.log("oracle signer:", oracle.signer());
    }
}
