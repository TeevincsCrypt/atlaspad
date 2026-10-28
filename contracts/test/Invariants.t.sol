// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BaseTest} from "./Base.t.sol";
import {AtlasLaunchpad} from "../src/AtlasLaunchpad.sol";
import {NationTreasury} from "../src/NationTreasury.sol";
import {NationToken} from "../src/NationToken.sol";
import {MockWIF} from "./mocks/MockWIF.sol";

contract LaunchpadHandler is Test {
    AtlasLaunchpad internal immutable lp;
    NationTreasury internal immutable treasury;
    address[] internal actors;
    uint256 public buys;
    uint256 public sells;
    uint256 public donations;

    constructor(AtlasLaunchpad lp_, NationTreasury treasury_) {
        lp = lp_;
        treasury = treasury_;
        for (uint256 i; i < 4; i++) {
            address a = address(uint160(0xA11CE + i));
            actors.push(a);
            MockWIF wif = MockWIF(address(lp_.wif()));
            wif.mint(a, 10_000 ether);
            vm.startPrank(a);
            wif.approve(address(lp_), type(uint256).max);
            wif.approve(address(treasury_), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _nation(uint256 seed) internal view returns (uint256) {
        return (seed % lp.nationCount()) + 1;
    }

    function buy(uint256 actorSeed, uint256 nationSeed, uint256 amount) external {
        uint256 id = _nation(nationSeed);
        if (lp.getNation(id).graduated) return;
        amount = bound(amount, 1e6, 0.8 ether);
        vm.prank(actors[actorSeed % actors.length]);
        lp.buy(id, amount, 0, block.timestamp);
        buys++;
    }

    function sell(uint256 actorSeed, uint256 nationSeed, uint256 fraction) external {
        uint256 id = _nation(nationSeed);
        AtlasLaunchpad.Nation memory n = lp.getNation(id);
        if (n.graduated) return;
        address actor = actors[actorSeed % actors.length];
        uint256 bal = NationToken(n.token).balanceOf(actor);
        uint256 amount = (bal * bound(fraction, 1, 100)) / 100;
        if (amount == 0) return;
        (uint256 quoted,) = lp.quoteSell(id, amount);
        if (quoted == 0) return;
        vm.startPrank(actor);
        NationToken(n.token).approve(address(lp), amount);
        lp.sell(id, amount, 0, block.timestamp);
        vm.stopPrank();
        sells++;
    }

    function donate(uint256 nationSeed, uint256 amount) external {
        amount = bound(amount, 1, 1 ether);
        uint256 id = _nation(nationSeed); // resolve before the prank: the external call would consume it
        vm.prank(actors[0]);
        treasury.deposit(id, amount);
        donations++;
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 3 days));
    }

    function claimFounder(uint256 nationSeed) external {
        uint256 id = _nation(nationSeed);
        AtlasLaunchpad.Nation memory n = lp.getNation(id);
        if (!n.graduated || lp.vestedFounderTokens(id) == n.founderClaimed) return;
        vm.prank(n.founder);
        lp.claimFounderTokens(id);
    }
}

contract InvariantsTest is BaseTest {
    LaunchpadHandler internal handler;
    uint256[] internal ids;

    function setUp() public override {
        super.setUp();
        AtlasLaunchpad.FoundingParams memory p = _params("Pepeland", "PEPE");
        (uint256 a,) = _foundWith(p, 0);
        p = _params("Dogeland", "DOGE");
        p.founderBps = 500;
        p.totalSupply = 69_000_000_000 ether;
        (uint256 b,) = _foundWith(p, 0);
        p = _params("Wifia", "WIF");
        p.founderBps = 250;
        p.totalSupply = 1_000_000 ether;
        (uint256 c,) = _foundWith(p, 0);
        ids.push(a);
        ids.push(b);
        ids.push(c);

        handler = new LaunchpadHandler(launchpad, treasury);
        targetContract(address(handler));
    }

    /// The launchpad holds exactly the curve reserves of un-graduated nations plus unpaid protocol fees.
    function invariant_WifSolvency() public view {
        assertEq(wif.balanceOf(address(launchpad)), _wifInvariant() + launchpad.protocolFeesAccrued());
    }

    /// Every $WIF the launchpad says it burned is sitting at the dead address.
    function invariant_BurnAccounting() public view {
        assertEq(wif.balanceOf(launchpad.DEAD()), launchpad.totalWifBurned());
        uint256 sum;
        for (uint256 i; i < ids.length; i++) {
            sum += launchpad.wifBurnedOf(ids[i]);
        }
        assertEq(sum, launchpad.totalWifBurned());
    }

    /// The treasury holds exactly the sum of nation balances.
    function invariant_TreasurySolvency() public view {
        uint256 sum;
        for (uint256 i; i < ids.length; i++) {
            sum += treasury.balanceOf(ids[i]);
        }
        assertEq(wif.balanceOf(address(treasury)), sum);
        assertEq(treasury.totalHeld(), sum);
    }

    /// Token custody: the launchpad holds remaining curve supply + LP reserve + unclaimed founder allocation.
    function invariant_TokenCustody() public view {
        for (uint256 i; i < ids.length; i++) {
            AtlasLaunchpad.Nation memory n = launchpad.getNation(ids[i]);
            uint256 expected = n.curveTokensRemaining + n.lpReserve + n.founderAllocation - n.founderClaimed;
            assertEq(NationToken(n.token).balanceOf(address(launchpad)), expected);
            assertEq(NationToken(n.token).totalSupply(), n.totalSupply);
            assertLe(n.curveTokensRemaining, n.curveSupply);
        }
    }

    /// The curve never holds less $WIF than its virtual-reserve accounting implies.
    function invariant_RealEthMatchesVirtual() public view {
        for (uint256 i; i < ids.length; i++) {
            AtlasLaunchpad.Nation memory n = launchpad.getNation(ids[i]);
            if (n.graduated) continue;
            assertEq(n.virtualWif - n.initialVirtualWif, n.realWif);
        }
    }
}
