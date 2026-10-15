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
import {TestnetExecutionAdapter} from "../src/adapters/TestnetExecutionAdapter.sol";
import {ControllerBoundAdapter} from "../src/adapters/ControllerBoundAdapter.sol";
import {IExecutionAdapter} from "../src/interfaces/IExecutionAdapter.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {CorePilotTypes} from "../src/libraries/CorePilotTypes.sol";

contract ZeroIdAdapter is IExecutionAdapter {
    function execute(uint256, bytes calldata) external pure returns (bytes32) {
        return bytes32(0);
    }
}

contract RevertingAdapter is IExecutionAdapter {
    error DispatchFailed();

    function execute(uint256, bytes calldata) external pure returns (bytes32) {
        revert DispatchFailed();
    }
}

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
        staking.setStrategyRegistry(address(registry));
        receipts = new ExecutionReceiptRegistry();
        oracle = new SignedMarketDataOracle(address(this));
        adapter = new MockExecutionAdapter();
        controller = new ExecutionController(registry, oracle, adapter, receipts);
        receipts.setController(address(controller));
        adapter.setController(address(controller));

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
        (, bytes32 storedId, uint256 notional, bool accepted, , , address recordedExecutor) =
            receipts.receipts(1);
        assertEq(storedId, id);
        assertEq(notional, 5_000);
        assertTrue(accepted); // adapter dispatch only, not a venue fill
        assertEq(recordedExecutor, executor);
        assertEq(
            uint8(receipts.receiptStatus(1)),
            uint8(ExecutionReceiptRegistry.ReceiptStatus.ADAPTER_REQUESTED)
        );
    }

    function test_mock_adapter_rejects_direct_request() public {
        vm.expectRevert(ControllerBoundAdapter.NotController.selector);
        adapter.execute(strategyId, abi.encode(_req(5_000, 200, 40, HYPE)));
        assertEq(adapter.nonce(), 0);
    }

    function test_testnet_adapter_rejects_direct_request() public {
        TestnetExecutionAdapter testnet = new TestnetExecutionAdapter();
        testnet.setController(address(controller));
        vm.expectRevert(ControllerBoundAdapter.NotController.selector);
        testnet.execute(strategyId, abi.encode(_req(5_000, 200, 40, HYPE)));
        assertEq(testnet.nonce(), 0);
    }

    function test_testnet_adapter_dispatch_records_request_not_fill() public {
        TestnetExecutionAdapter testnet = new TestnetExecutionAdapter();
        testnet.setController(address(controller));
        controller.setAdapter(testnet);
        vm.prank(executor);
        bytes32 requestId = controller.execute(_req(5_000, 200, 40, HYPE));
        assertTrue(requestId != bytes32(0));
        assertEq(testnet.nonce(), 1);
        (, bytes32 storedId, , bool accepted, , , ) = receipts.receipts(1);
        assertEq(storedId, requestId);
        assertTrue(accepted); // only adapter request accepted, not a HyperCore fill
        assertEq(
            uint8(receipts.receiptStatus(1)),
            uint8(ExecutionReceiptRegistry.ReceiptStatus.ADAPTER_REQUESTED)
        );
    }

    function test_creator_bond_cannot_be_stolen_by_other_account() public {
        address attacker = address(0xBAD);
        vm.prank(attacker);
        vm.expectRevert(PilotStaking.NotStrategyCreator.selector);
        staking.stakeCreator(strategyId, 1);

        vm.prank(attacker);
        vm.expectRevert(PilotStaking.NotStrategyCreator.selector);
        staking.requestUnstakeCreator(strategyId);

        vm.prank(creator);
        staking.requestUnstakeCreator(strategyId);
        vm.warp(block.timestamp + staking.COOLDOWN());

        vm.prank(attacker);
        vm.expectRevert(PilotStaking.NotStrategyCreator.selector);
        staking.unstakeCreator(strategyId);

        uint256 beforeBalance = pilot.balanceOf(creator);
        vm.prank(creator);
        staking.unstakeCreator(strategyId);
        assertEq(pilot.balanceOf(creator) - beforeBalance, 5_000e18);
    }

    function test_unbonded_creator_cannot_execute_while_strategy_still_active() public {
        vm.prank(creator);
        registry.updateStrategy(strategyId, 300, 50, 25_000, block.timestamp + 3 days);
        vm.prank(creator);
        staking.requestUnstakeCreator(strategyId);
        vm.warp(block.timestamp + staking.COOLDOWN());
        vm.prank(creator);
        staking.unstakeCreator(strategyId);
        oracle.forceData(HYPE, 46_20 * 1e6, -1, block.timestamp * 1000);

        vm.prank(executor);
        vm.expectRevert(ExecutionController.CreatorNotBonded.selector);
        controller.execute(_req(5_000, 200, 40, HYPE));
        assertEq(receipts.nextReceiptId(), 1);
    }

    function test_zero_notional_and_leverage_rejected() public {
        vm.prank(executor);
        vm.expectRevert(ExecutionController.InvalidExecutionRequest.selector);
        controller.execute(_req(0, 200, 40, HYPE));

        vm.prank(executor);
        vm.expectRevert(ExecutionController.InvalidExecutionRequest.selector);
        controller.execute(_req(5_000, 0, 40, HYPE));
    }

    function test_future_market_data_rejected() public {
        oracle.forceData(HYPE, 46_20 * 1e6, -1, block.timestamp * 1000 + 1000);
        vm.prank(executor);
        vm.expectRevert(ExecutionController.InvalidMarketData.selector);
        controller.execute(_req(5_000, 200, 40, HYPE));
    }

    function test_zero_adapter_id_reverts_without_receipt() public {
        controller.setAdapter(new ZeroIdAdapter());
        vm.prank(executor);
        vm.expectRevert(ExecutionController.InvalidAdapterRequestId.selector);
        controller.execute(_req(5_000, 200, 40, HYPE));
        assertEq(receipts.nextReceiptId(), 1);
    }

    function test_adapter_failure_reverts_without_receipt() public {
        controller.setAdapter(new RevertingAdapter());
        vm.prank(executor);
        vm.expectRevert(RevertingAdapter.DispatchFailed.selector);
        controller.execute(_req(5_000, 200, 40, HYPE));
        assertEq(receipts.nextReceiptId(), 1);
    }

    function test_rejection_is_only_executor_report_not_verified_failure() public {
        bytes32 reason = bytes32("OFFCHAIN_POLICY_DENIED");
        vm.prank(executor);
        controller.recordRejection(strategyId, reason);
        (, bytes32 requestId, uint256 notional, bool accepted, bytes32 storedReason, , address recordedExecutor) =
            receipts.receipts(1);
        assertEq(requestId, bytes32(0));
        assertEq(notional, 0);
        assertFalse(accepted);
        assertEq(storedReason, reason);
        assertEq(recordedExecutor, executor);
        assertEq(
            uint8(receipts.receiptStatus(1)),
            uint8(ExecutionReceiptRegistry.ReceiptStatus.EXECUTOR_REJECTION_REPORTED)
        );
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

    function test_revert_slippage_exceeded() public {
        vm.prank(executor);
        vm.expectRevert(ExecutionController.SlippageExceeded.selector);
        controller.execute(_req(5_000, 200, 51, HYPE));
    }

    function test_revert_inactive_strategy() public {
        vm.prank(creator);
        registry.setActive(strategyId, false);
        vm.prank(executor);
        vm.expectRevert(ExecutionController.StrategyInactive.selector);
        controller.execute(_req(5_000, 200, 40, HYPE));
    }

    function test_registry_update_cannot_zero_hard_bounds() public {
        vm.prank(creator);
        vm.expectRevert(StrategyRegistry.InvalidParams.selector);
        registry.updateStrategy(strategyId, 0, 50, 25_000, block.timestamp + 2 days);

        vm.prank(creator);
        vm.expectRevert(StrategyRegistry.InvalidParams.selector);
        registry.updateStrategy(strategyId, 300, 50, 0, block.timestamp + 2 days);
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
