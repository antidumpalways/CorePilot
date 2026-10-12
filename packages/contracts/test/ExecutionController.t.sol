// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PilotToken} from "../src/PilotToken.sol";
import {PilotStaking} from "../src/PilotStaking.sol";
import {StrategyRegistry} from "../src/StrategyRegistry.sol";
import {ExecutionReceiptRegistry} from "../src/ExecutionReceiptRegistry.sol";
import {ExecutionController} from "../src/ExecutionController.sol";
import {SignedMarketDataOracle} from "../src/oracle/SignedMarketDataOracle.sol";
import {MockExecutionAdapter} from "../src/adapters/MockExecutionAdapter.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {CorePilotTypes} from "../src/libraries/CorePilotTypes.sol";

contract ExecutionControllerTest is Test {
    PilotToken pilot;
    PilotStaking staking;
    StrategyRegistry registry;
    ExecutionReceiptRegistry receipts;
    SignedMarketDataOracle oracle;
    MockExecutionAdapter adapter;
    ExecutionController controller;

    address creator = address(0xC0FFEE);
    address executor = address(0xEEEC);

    bytes32 constant HYPE = bytes32("HYPE");
    bytes32 constant FUNDING_TRIGGER = bytes32("FUNDING_TRIGGER");

    uint256 strategyId;

    function setUp() public {
        pilot = new PilotToken();
        staking = new PilotStaking(IERC20(address(pilot)));
        registry = new StrategyRegistry(staking);
        receipts = new ExecutionReceiptRegistry();
        oracle = new SignedMarketDataOracle(address(this));
        adapter = new MockExecutionAdapter();
        controller = new ExecutionController(registry, oracle, adapter, receipts);
        receipts.setController(address(controller));

        // fund + bond creator and executor
        pilot.mint(creator, 100_000e18);
        pilot.mint(executor, 100_000e18);

        vm.prank(creator);
        pilot.approve(address(staking), type(uint256).max);
        vm.prank(executor);
        pilot.approve(address(staking), type(uint256).max);

        // create + activate strategy
        vm.prank(creator);
        strategyId = registry.createStrategy(
            HYPE, FUNDING_TRIGGER, 300, 50, 25_000, block.timestamp + 24 hours
        );

        vm.prank(creator);
        staking.stakeCreator(strategyId, 5_000e18);
        vm.prank(creator);
        registry.setActive(strategyId, true);

        vm.prank(executor);
        staking.stakeExecutor(5_000e18);
        controller.setExecutor(executor);

        // seed market data (mark = $46.20, funding = -1 bps, fresh)
        oracle.forceData(HYPE, 46_20 * 1e6, -1, block.timestamp * 1000);
    }

    function _req(uint256 notional, uint256 lev, uint256 slip, bytes32 market)
        internal
        view
        returns (CorePilotTypes.ExecutionRequest memory)
    {
        return CorePilotTypes.ExecutionRequest({
            strategyId: strategyId,
            market: market,
            isLong: true,
            notionalUsd: notional,
            leverageBps: lev,
            slippageBps: slip
        });
    }

    function test_execute_success() public {
        vm.prank(executor);
        bytes32 id = controller.execute(_req(5_000, 200, 40, HYPE));
        assertTrue(id != bytes32(0));
        assertEq(receipts.nextReceiptId(), 2); // id 1
    }

    function test_revert_market_not_allowed() public {
        vm.prank(executor);
        vm.expectRevert(ExecutionController.MarketNotAllowed.selector);
        controller.execute(_req(5_000, 200, 40, bytes32("BTC")));
    }

    function test_revert_notional_exceeded() public {
        vm.prank(executor);
        vm.expectRevert(ExecutionController.NotionalExceeded.selector);
        controller.execute(_req(30_000, 200, 40, HYPE));
    }

    function test_revert_leverage_exceeded() public {
        vm.prank(executor);
        vm.expectRevert(ExecutionController.LeverageExceeded.selector);
        controller.execute(_req(5_000, 400, 40, HYPE));
    }

    function test_revert_expired() public {
        vm.warp(block.timestamp + 25 hours);
        vm.prank(executor);
        vm.expectRevert(ExecutionController.StrategyExpired.selector);
        controller.execute(_req(5_000, 200, 40, HYPE));
    }

    function test_revert_stale_data() public {
        vm.warp(block.timestamp + 10 minutes);
        vm.prank(executor);
        vm.expectRevert(ExecutionController.InvalidMarketData.selector);
        controller.execute(_req(5_000, 200, 40, HYPE));
    }

    function test_revert_executor_not_bonded() public {
        address rando = address(0xBEEF);
        controller.setExecutor(rando);
        vm.prank(rando);
        vm.expectRevert(ExecutionController.ExecutorNotBonded.selector);
        controller.execute(_req(5_000, 200, 40, HYPE));
    }
}
