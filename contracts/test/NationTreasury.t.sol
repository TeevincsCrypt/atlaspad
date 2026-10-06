// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {NationTreasury} from "../src/NationTreasury.sol";

contract RevertingReceiver {
    receive() external payable {
        revert("no");
    }
}

contract NationTreasuryTest is BaseTest {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        (id,) = _found("Pepeland", "PEPE");
    }

    function test_TradeFeesAccrueToTreasury() public {
        _buy(alice, id, 1 ether);
        assertEq(treasury.balanceOf(id), 0.005 ether);
        assertEq(treasury.totalReceived(id), 0.005 ether);
        assertEq(address(treasury).balance, treasury.totalHeld());
    }

    function test_Donation() public {
        vm.expectEmit(true, true, false, true);
        emit NationTreasury.Deposited(id, alice, 1 ether, false);
        vm.prank(alice);
        treasury.deposit{value: 1 ether}(id);
        assertEq(treasury.balanceOf(id), 1 ether);
        assertEq(treasury.releaseCap(id), 0.25 ether);
    }

    function test_RevertWhen_DepositUnknownNation() public {
        vm.prank(alice);
        vm.expectRevert(NationTreasury.UnknownNation.selector);
        treasury.deposit{value: 1 ether}(99);
    }

    function test_RevertWhen_DepositZero() public {
        vm.expectRevert(NationTreasury.ZeroAmount.selector);
        treasury.deposit{value: 0}(id);
    }

    function test_RevertWhen_DirectTransfer() public {
        vm.prank(alice);
        (bool ok,) = address(treasury).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_RevertWhen_ReleaseNotGovernor() public {
        vm.prank(alice);
        treasury.deposit{value: 1 ether}(id);
        vm.prank(founder);
        vm.expectRevert(NationTreasury.OnlyGovernor.selector);
        treasury.release(id, payable(founder), 0.1 ether, 1);
        // Not even the deployer/fee recipient
        vm.prank(feeRecipient);
        vm.expectRevert(NationTreasury.OnlyGovernor.selector);
        treasury.release(id, payable(feeRecipient), 0.1 ether, 1);
    }

    function test_ReleaseCapAndAccounting() public {
        vm.prank(alice);
        treasury.deposit{value: 4 ether}(id);
        vm.prank(address(governor));
        vm.expectRevert(NationTreasury.ExceedsReleaseCap.selector);
        treasury.release(id, payable(bob), 1 ether + 1, 7);

        uint256 before = bob.balance;
        vm.prank(address(governor));
        treasury.release(id, payable(bob), 1 ether, 7);
        assertEq(bob.balance - before, 1 ether);
        assertEq(treasury.balanceOf(id), 3 ether);
        assertEq(treasury.totalReleased(id), 1 ether);
        assertEq(treasury.totalHeld(), address(treasury).balance);
    }

    function test_RevertWhen_InvalidRecipientOrAmount() public {
        vm.prank(alice);
        treasury.deposit{value: 4 ether}(id);
        vm.startPrank(address(governor));
        vm.expectRevert(NationTreasury.InvalidRecipient.selector);
        treasury.release(id, payable(address(0)), 1, 1);
        vm.expectRevert(NationTreasury.InvalidRecipient.selector);
        treasury.release(id, payable(address(treasury)), 1, 1);
        vm.expectRevert(NationTreasury.ZeroAmount.selector);
        treasury.release(id, payable(bob), 0, 1);
        vm.stopPrank();
    }

    function test_RevertWhen_RecipientRejectsEth() public {
        vm.prank(alice);
        treasury.deposit{value: 4 ether}(id);
        RevertingReceiver r = new RevertingReceiver();
        vm.prank(address(governor));
        vm.expectRevert(NationTreasury.EthTransferFailed.selector);
        treasury.release(id, payable(address(r)), 1 ether, 1);
        assertEq(treasury.balanceOf(id), 4 ether);
    }

    function test_NationsAreIsolated() public {
        (uint256 id2,) = _found("Dogeland", "DOGE");
        vm.prank(alice);
        treasury.deposit{value: 4 ether}(id);
        vm.prank(address(governor));
        vm.expectRevert(NationTreasury.ExceedsReleaseCap.selector);
        treasury.release(id2, payable(bob), 1, 1);
    }
}
