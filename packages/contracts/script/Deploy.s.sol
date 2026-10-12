// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PilotToken} from "../src/PilotToken.sol";
import {PilotStaking} from "../src/PilotStaking.sol";
import {StrategyRegistry} from "../src/StrategyRegistry.sol";
import {ExecutionReceiptRegistry} from "../src/ExecutionReceiptRegistry.sol";
import {ExecutionController} from "../src/ExecutionController.sol";
import {FeeModule} from "../src/FeeModule.sol";
import {SignedMarketDataOracle} from "../src/oracle/SignedMarketDataOracle.sol";
import {MockExecutionAdapter} from "../src/adapters/MockExecutionAdapter.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

/// @notice Deploys the CorePilot MVP stack to Elysium testnet.
/// Usage:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $ELYSIUM_RPC_URL --broadcast
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        PilotToken pilot = new PilotToken();
        PilotStaking staking = new PilotStaking(IERC20(address(pilot)));
        StrategyRegistry registry = new StrategyRegistry(staking);
        ExecutionReceiptRegistry receipts = new ExecutionReceiptRegistry();
        SignedMarketDataOracle oracle = new SignedMarketDataOracle(deployer);
        MockExecutionAdapter adapter = new MockExecutionAdapter();
        ExecutionController controller =
            new ExecutionController(registry, oracle, adapter, receipts);
        receipts.setController(address(controller));

        // FeeModule needs USDC + PILOT addresses. On testnet, pass the deployed USDC predeploy.
        address usdc = vm.envOr("USDC_ADDRESS", address(0));
        FeeModule feeModule = new FeeModule(
            IERC20(usdc),
            IERC20(address(pilot)),
            deployer, // treasury
            deployer, // buyback vault (MVP placeholder)
            5000,
            2000,
            1000,
            2000
        );

        vm.stopBroadcast();

        console2.log("PilotToken:", address(pilot));
        console2.log("PilotStaking:", address(staking));
        console2.log("StrategyRegistry:", address(registry));
        console2.log("ExecutionReceiptRegistry:", address(receipts));
        console2.log("SignedMarketDataOracle:", address(oracle));
        console2.log("MockExecutionAdapter:", address(adapter));
        console2.log("ExecutionController:", address(controller));
        console2.log("FeeModule:", address(feeModule));
    }
}
