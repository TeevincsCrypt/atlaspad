// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {AtlasLaunchpad} from "../src/AtlasLaunchpad.sol";
import {NationToken} from "../src/NationToken.sol";
import {NationTokenFactory} from "../src/NationTokenFactory.sol";
import {UniswapV2Pair} from "./mocks/UniswapV2.sol";

contract AtlasLaunchpadDeploymentTest is BaseTest {
    function test_ImmutableConfiguration() public view {
        assertEq(launchpad.uniswapV2Factory(), address(v2Factory));
        assertEq(launchpad.weth(), address(weth));
        assertEq(address(launchpad.treasury()), address(treasury));
        assertEq(launchpad.governor(), address(governor));
        assertEq(launchpad.protocolFeeRecipient(), feeRecipient);
        assertEq(launchpad.graduationEth(), GRADUATION_ETH);
        assertEq(launchpad.creationFee(), CREATION_FEE);
        assertEq(launchpad.tokenFactory().launchpad(), address(launchpad));
        assertEq(address(treasury.launchpad()), address(launchpad));
        assertEq(treasury.governor(), address(governor));
        assertEq(address(governor.launchpad()), address(launchpad));
        assertEq(address(governor.treasury()), address(treasury));
    }

    function test_RevertWhen_ZeroAddressConfig() public {
        vm.expectRevert(AtlasLaunchpad.InvalidConfig.selector);
        new AtlasLaunchpad(address(0), address(weth), address(treasury), address(governor), feeRecipient, 1 ether, 0);
        vm.expectRevert(AtlasLaunchpad.InvalidConfig.selector);
        new AtlasLaunchpad(address(v2Factory), address(weth), address(treasury), address(governor), address(0), 1 ether, 0);
    }

    function test_RevertWhen_GraduationOutOfBounds() public {
        vm.expectRevert(AtlasLaunchpad.InvalidConfig.selector);
        new AtlasLaunchpad(
            address(v2Factory), address(weth), address(treasury), address(governor), feeRecipient, 0.001 ether, 0
        );
        vm.expectRevert(AtlasLaunchpad.InvalidConfig.selector);
        new AtlasLaunchpad(
            address(v2Factory), address(weth), address(treasury), address(governor), feeRecipient, 10_001 ether, 0
        );
    }

    function test_RevertWhen_CreationFeeTooHigh() public {
        vm.expectRevert(AtlasLaunchpad.InvalidConfig.selector);
        new AtlasLaunchpad(
            address(v2Factory), address(weth), address(treasury), address(governor), feeRecipient, 1 ether, 1.1 ether
        );
    }

    function test_TokenFactoryOnlyLaunchpad() public {
        NationTokenFactory f = launchpad.tokenFactory();
        vm.expectRevert(NationTokenFactory.OnlyLaunchpad.selector);
        f.deploy("X Land", "XL", 99, SUPPLY, address(v2Factory), address(weth));
    }
}

contract AtlasLaunchpadFoundingTest is BaseTest {
    function test_FoundNation() public {
        vm.expectEmit(true, false, true, false);
        emit AtlasLaunchpad.NationFounded(1, address(0), founder, "Pepeland", "PEPE", 5, 0x1234, "", "");
        (uint256 id, NationToken token) = _found("Pepeland", "PEPE");
        assertEq(id, 1);
        assertEq(launchpad.nationCount(), 1);
        assertEq(token.name(), "Pepeland");
        assertEq(token.symbol(), "PEPE");
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(address(launchpad)), SUPPLY);
        assertEq(token.nationId(), 1);
        assertEq(token.launchpad(), address(launchpad));
        assertEq(launchpad.nationIdOfToken(address(token)), 1);
        assertEq(launchpad.tokenOf(1), address(token));

        AtlasLaunchpad.Nation memory n = launchpad.getNation(1);
        assertEq(n.founder, founder);
        assertEq(n.pair, token.pair());
        assertEq(n.pair, v2Factory.getPair(address(token), address(weth)));
        assertEq(n.theme, 5);
        assertEq(n.emblem, 0x1234);
        assertEq(n.lpReserve, SUPPLY / 5);
        assertEq(n.founderAllocation, 0);
        assertEq(n.curveSupply, SUPPLY - SUPPLY / 5);
        assertEq(n.curveTokensRemaining, n.curveSupply);
        assertEq(n.realEth, 0);
        assertFalse(n.graduated);
        assertEq(launchpad.protocolFeesAccrued(), CREATION_FEE);
    }

    function test_CurveShapeMatchesDerivation() public {
        (uint256 id,) = _found("Pepeland", "PEPE");
        AtlasLaunchpad.Nation memory n = launchpad.getNation(id);
        uint256 c = n.curveSupply;
        uint256 l = n.lpReserve;
        assertEq(n.virtualTokens, (c * c) / (c - l));
        assertEq(n.virtualEth, (GRADUATION_ETH * l) / (c - l));
        // Opening market cap = 0.3125 * graduationEth for a 0% founder allocation.
        uint256 openingMcap = (n.virtualEth * SUPPLY) / n.virtualTokens;
        assertApproxEqRel(openingMcap, (GRADUATION_ETH * 3125) / 10_000, 1e12);
    }

    function test_FounderAllocationReducesCurveSupply() public {
        AtlasLaunchpad.FoundingParams memory p = _params("Dogeland", "DOGE");
        p.founderBps = 500;
        (uint256 id,) = _foundWith(p, 0);
        AtlasLaunchpad.Nation memory n = launchpad.getNation(id);
        assertEq(n.founderAllocation, SUPPLY / 20);
        assertEq(n.curveSupply, SUPPLY - SUPPLY / 5 - SUPPLY / 20);
    }

    function test_InitialBuy() public {
        AtlasLaunchpad.FoundingParams memory p = _params("Wifia", "WIF");
        (uint256 id, NationToken token) = _foundWith(p, 0.05 ether);
        assertGt(token.balanceOf(founder), 0);
        assertEq(launchpad.getNation(id).realEth, 0.05 ether - (0.05 ether * 100) / 10_000);
        // founder auto-delegated and can vote
        assertEq(token.delegates(founder), founder);
    }

    function test_RevertWhen_InitialBuyTooLarge() public {
        AtlasLaunchpad.FoundingParams memory p = _params("Wifia", "WIF");
        vm.deal(founder, 100 ether);
        vm.prank(founder);
        vm.expectRevert(AtlasLaunchpad.InitialBuyTooLarge.selector);
        launchpad.foundNation{value: CREATION_FEE + 1 ether}(p);
    }

    function test_RevertWhen_InitialBuySlippage() public {
        AtlasLaunchpad.FoundingParams memory p = _params("Wifia", "WIF");
        p.minTokensOut = type(uint256).max;
        vm.prank(founder);
        vm.expectRevert(AtlasLaunchpad.Slippage.selector);
        launchpad.foundNation{value: CREATION_FEE + 0.01 ether}(p);
    }

    function test_RevertWhen_CreationFeeMissing() public {
        vm.prank(founder);
        vm.expectRevert(AtlasLaunchpad.InsufficientCreationFee.selector);
        launchpad.foundNation{value: CREATION_FEE - 1}(_params("Pepeland", "PEPE"));
    }

    function test_RevertWhen_NameTakenCaseInsensitive() public {
        _found("Pepeland", "PEPE");
        vm.prank(founder);
        vm.expectRevert(AtlasLaunchpad.NameTaken.selector);
        launchpad.foundNation{value: CREATION_FEE}(_params("PEPELAND", "PEPE2"));
        assertFalse(launchpad.isNameAvailable("pepeland"));
        assertTrue(launchpad.isNameAvailable("Dogeland"));
    }

    function test_RevertWhen_SymbolTaken() public {
        _found("Pepeland", "PEPE");
        vm.prank(founder);
        vm.expectRevert(AtlasLaunchpad.SymbolTaken.selector);
        launchpad.foundNation{value: CREATION_FEE}(_params("Frogland", "PEPE"));
        assertFalse(launchpad.isSymbolAvailable("PEPE"));
    }

    function test_RevertWhen_InvalidNames() public {
        string[8] memory bad = ["A", "", " Leading", "Trailing ", "Double  Space", "Emoji\xF0\x9F\x90\xB8", "Semi;colon",
            "ThisNameIsWayTooLongForANationOk1"];
        for (uint256 i; i < bad.length; i++) {
            vm.prank(founder);
            vm.expectRevert(AtlasLaunchpad.InvalidName.selector);
            launchpad.foundNation{value: CREATION_FEE}(_params(bad[i], "OK"));
        }
    }

    function test_ValidNames() public {
        _found("St. Kitts-Nevis", "SKN");
        _found("O'Brien Republic 2", "OBR2");
    }

    function test_RevertWhen_InvalidSymbols() public {
        string[5] memory bad = ["P", "pepe", "PE PE", "PEPE$", "ABCDEFGHIJK"];
        for (uint256 i; i < bad.length; i++) {
            vm.prank(founder);
            vm.expectRevert(AtlasLaunchpad.InvalidSymbol.selector);
            launchpad.foundNation{value: CREATION_FEE}(_params("Valid Name", bad[i]));
        }
    }

    function test_RevertWhen_InvalidTheme() public {
        AtlasLaunchpad.FoundingParams memory p = _params("Pepeland", "PEPE");
        p.theme = 8;
        vm.prank(founder);
        vm.expectRevert(AtlasLaunchpad.InvalidTheme.selector);
        launchpad.foundNation{value: CREATION_FEE}(p);
    }

    function test_RevertWhen_InvalidSupply() public {
        uint256[4] memory bad = [uint256(999_999 ether), 1_000_000_000_001 ether, 1_000_000 ether + 1, 0];
        for (uint256 i; i < bad.length; i++) {
            AtlasLaunchpad.FoundingParams memory p = _params("Pepeland", "PEPE");
            p.totalSupply = bad[i];
            vm.prank(founder);
            vm.expectRevert(AtlasLaunchpad.InvalidSupply.selector);
            launchpad.foundNation{value: CREATION_FEE}(p);
        }
    }

    function test_SupplyBounds() public {
        AtlasLaunchpad.FoundingParams memory p = _params("Small Land", "SMOL");
        p.totalSupply = 1_000_000 ether;
        _foundWith(p, 0);
        p = _params("Huge Land", "HUGE");
        p.totalSupply = 1_000_000_000_000 ether;
        p.founderBps = 500;
        (uint256 id,) = _foundWith(p, 0);
        _graduate(id); // math must hold at the largest supply
        assertTrue(launchpad.getNation(id).graduated);
    }

    function test_RevertWhen_FounderBpsTooHigh() public {
        AtlasLaunchpad.FoundingParams memory p = _params("Pepeland", "PEPE");
        p.founderBps = 501;
        vm.prank(founder);
        vm.expectRevert(AtlasLaunchpad.InvalidFounderBps.selector);
        launchpad.foundNation{value: CREATION_FEE}(p);
    }

    function test_RevertWhen_TextTooLong() public {
        AtlasLaunchpad.FoundingParams memory p = _params("Pepeland", "PEPE");
        p.description = string(new bytes(281));
        vm.prank(founder);
        vm.expectRevert(AtlasLaunchpad.TextTooLong.selector);
        launchpad.foundNation{value: CREATION_FEE}(p);
        p.description = "";
        p.metadataURI = string(new bytes(201));
        vm.prank(founder);
        vm.expectRevert(AtlasLaunchpad.TextTooLong.selector);
        launchpad.foundNation{value: CREATION_FEE}(p);
    }

    function test_FoundingSurvivesPreCreatedPair() public {
        // An attacker pre-computes the next token address and creates the pair first.
        AtlasLaunchpad.FoundingParams memory p = _params("Pepeland", "PEPE");
        bytes memory init = abi.encodePacked(
            type(NationToken).creationCode,
            abi.encode(p.name, p.symbol, uint256(1), p.totalSupply, address(launchpad), address(v2Factory), address(weth))
        );
        address predicted = vm.computeCreate2Address(bytes32(uint256(1)), keccak256(init), address(launchpad.tokenFactory()));
        address prePair = v2Factory.createPair(predicted, address(weth));
        (, NationToken token) = _foundWith(p, 0);
        assertEq(address(token), predicted);
        assertEq(token.pair(), prePair);
    }
}

contract AtlasLaunchpadTradingTest is BaseTest {
    uint256 internal id;
    NationToken internal token;

    function setUp() public override {
        super.setUp();
        (id, token) = _found("Pepeland", "PEPE");
    }

    function test_BuyMatchesQuoteAndSplitsFees() public {
        (uint256 quoted, uint256 fee, uint256 used, uint256 refund) = launchpad.quoteBuy(id, 0.5 ether);
        assertEq(fee, 0.005 ether);
        assertEq(used, 0.5 ether);
        assertEq(refund, 0);
        uint256 protocolBefore = launchpad.protocolFeesAccrued();

        uint256 out = _buy(alice, id, 0.5 ether);
        assertEq(out, quoted);
        assertEq(token.balanceOf(alice), out);
        assertEq(treasury.balanceOf(id), 0.0025 ether);
        assertEq(launchpad.protocolFeesAccrued() - protocolBefore, 0.0025 ether);
        assertEq(launchpad.getNation(id).realEth, 0.495 ether);
        assertEq(token.delegates(alice), alice);
        assertEq(token.getVotes(alice), out);
    }

    function test_BuyEmitsTrade() public {
        vm.expectEmit(true, true, false, false);
        emit AtlasLaunchpad.Trade(id, alice, true, 0, 0, 0, 0, 0, 0, 0);
        _buy(alice, id, 0.1 ether);
    }

    function test_PriceIncreasesWithBuys() public {
        uint256 p0 = launchpad.spotPrice(id);
        _buy(alice, id, 0.2 ether);
        uint256 p1 = launchpad.spotPrice(id);
        _buy(bob, id, 0.2 ether);
        uint256 p2 = launchpad.spotPrice(id);
        assertGt(p1, p0);
        assertGt(p2, p1);
    }

    function test_SellReturnsEthMinusFees() public {
        uint256 out = _buy(alice, id, 1 ether);
        (uint256 quotedEth, uint256 fee) = launchpad.quoteSell(id, out);
        uint256 balBefore = alice.balance;
        uint256 ethOut = _sell(alice, id, out);
        assertEq(ethOut, quotedEth);
        assertEq(alice.balance - balBefore, ethOut);
        assertGt(fee, 0);
        // Round trip loses ~2% to fees, never gains.
        assertLt(ethOut, 1 ether);
        assertApproxEqRel(ethOut, 0.9801 ether, 0.001e18);
        assertEq(token.balanceOf(alice), 0);
    }

    function test_SellWithPermit() public {
        (address owner, uint256 pk) = makeAddrAndKey("permitOwner");
        vm.deal(owner, 10 ether);
        uint256 out = _buy(owner, id, 0.3 ether);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                        owner,
                        address(launchpad),
                        out,
                        token.nonces(owner),
                        deadline
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        vm.prank(owner);
        uint256 ethOut = launchpad.sellWithPermit(id, out, 0, deadline, v, r, s);
        assertGt(ethOut, 0);
        assertEq(token.balanceOf(owner), 0);
    }

    function test_RevertWhen_Expired() public {
        vm.prank(alice);
        vm.expectRevert(AtlasLaunchpad.Expired.selector);
        launchpad.buy{value: 1 ether}(id, 0, block.timestamp - 1);
        vm.prank(alice);
        vm.expectRevert(AtlasLaunchpad.Expired.selector);
        launchpad.sell(id, 1, 0, block.timestamp - 1);
    }

    function test_RevertWhen_BuySlippage() public {
        (uint256 quoted,,,) = launchpad.quoteBuy(id, 0.1 ether);
        _buy(bob, id, 0.1 ether); // front-run moves the price
        vm.prank(alice);
        vm.expectRevert(AtlasLaunchpad.Slippage.selector);
        launchpad.buy{value: 0.1 ether}(id, quoted, block.timestamp);
    }

    function test_RevertWhen_SellSlippage() public {
        uint256 out = _buy(alice, id, 0.5 ether);
        vm.startPrank(alice);
        token.approve(address(launchpad), out);
        vm.expectRevert(AtlasLaunchpad.Slippage.selector);
        launchpad.sell(id, out, 1 ether, block.timestamp);
        vm.stopPrank();
    }

    function test_RevertWhen_ZeroAmounts() public {
        vm.prank(alice);
        vm.expectRevert(AtlasLaunchpad.ZeroAmount.selector);
        launchpad.buy{value: 0}(id, 0, block.timestamp);
        vm.prank(alice);
        vm.expectRevert(AtlasLaunchpad.ZeroAmount.selector);
        launchpad.sell(id, 0, 0, block.timestamp);
    }

    function test_RevertWhen_UnknownNation() public {
        vm.prank(alice);
        vm.expectRevert(AtlasLaunchpad.UnknownNation.selector);
        launchpad.buy{value: 1 ether}(42, 0, block.timestamp);
        vm.expectRevert(AtlasLaunchpad.UnknownNation.selector);
        launchpad.getNation(42);
    }

    function test_RevertWhen_SellingWithoutApproval() public {
        uint256 out = _buy(alice, id, 0.5 ether);
        vm.prank(alice);
        vm.expectRevert();
        launchpad.sell(id, out, 0, block.timestamp);
    }

    function test_RevertWhen_SellingMoreThanCurveSold() public {
        // Founder-vested tokens cannot be dumped into the curve beyond what the curve sold.
        AtlasLaunchpad.FoundingParams memory p = _params("Dogeland", "DOGE");
        p.founderBps = 500;
        (uint256 did, NationToken dtoken) = _foundWith(p, 0);
        _buy(alice, did, 0.01 ether);
        vm.warp(block.timestamp + 30 days);
        vm.prank(founder);
        uint256 claimed = launchpad.claimFounderTokens(did);
        vm.startPrank(founder);
        dtoken.approve(address(launchpad), claimed);
        vm.expectRevert(AtlasLaunchpad.InsufficientCurveLiquidity.selector);
        launchpad.sell(did, claimed, 0, block.timestamp);
        vm.stopPrank();
    }

    function test_CurveIsolationBetweenNations() public {
        (uint256 id2,) = _found("Dogeland", "DOGE");
        _buy(alice, id, 1 ether);
        uint256 out2 = _buy(bob, id2, 0.01 ether);
        _sell(bob, id2, out2);
        // nation 1's reserve is untouched by nation 2's activity
        assertEq(launchpad.getNation(id).realEth, 0.99 ether);
        assertEq(address(launchpad).balance, _ethInvariant() + launchpad.protocolFeesAccrued());
    }

    function test_WithdrawProtocolFees() public {
        _buy(alice, id, 1 ether);
        uint256 accrued = launchpad.protocolFeesAccrued();
        vm.prank(bob); // anyone can trigger; funds always go to the immutable recipient
        launchpad.withdrawProtocolFees();
        assertEq(feeRecipient.balance, accrued);
        assertEq(launchpad.protocolFeesAccrued(), 0);
        vm.expectRevert(AtlasLaunchpad.NothingToClaim.selector);
        launchpad.withdrawProtocolFees();
    }

    function test_RevertWhen_SetSymbolNotGovernor() public {
        vm.prank(founder);
        vm.expectRevert(AtlasLaunchpad.OnlyGovernor.selector);
        launchpad.setNationSymbol(id, 1, "ipfs://x");
    }

    function testFuzz_BuySellRoundTripNeverProfits(uint96 ethIn) public {
        ethIn = uint96(bound(ethIn, 1e9, 1.5 ether));
        uint256 out = _buy(alice, id, ethIn);
        uint256 back = _sell(alice, id, out);
        assertLe(back, ethIn);
        assertEq(address(launchpad).balance, _ethInvariant() + launchpad.protocolFeesAccrued());
    }

    function testFuzz_QuoteBuyMatchesExecution(uint96 a, uint96 b) public {
        a = uint96(bound(a, 1e12, 1 ether));
        b = uint96(bound(b, 1e12, 3 ether));
        _buy(bob, id, a);
        (uint256 quoted,,, uint256 refund) = launchpad.quoteBuy(id, b);
        uint256 balBefore = alice.balance;
        uint256 out = _buy(alice, id, b);
        assertEq(out, quoted);
        assertEq(balBefore - alice.balance, b - refund);
    }
}

contract AtlasLaunchpadGraduationTest is BaseTest {
    uint256 internal id;
    NationToken internal token;

    function setUp() public override {
        super.setUp();
        (id, token) = _found("Pepeland", "PEPE");
    }

    function test_GraduationSeedsUniswapAndBurnsLp() public {
        AtlasLaunchpad.Nation memory before = launchpad.getNation(id);
        uint256 lastPrice;
        // Buy in chunks until one purchase sells out the curve.
        while (!launchpad.getNation(id).graduated) {
            lastPrice = launchpad.spotPrice(id);
            _buy(carol, id, 0.7 ether);
        }
        AtlasLaunchpad.Nation memory n = launchpad.getNation(id);
        assertTrue(n.graduated);
        assertTrue(token.graduated());
        assertEq(n.realEth, 0);
        assertEq(n.lpReserve, 0);
        assertEq(n.curveTokensRemaining, 0);
        assertEq(n.graduatedAt, block.timestamp);

        UniswapV2Pair pair = UniswapV2Pair(n.pair);
        (uint112 r0, uint112 r1,) = pair.getReserves();
        (uint256 tokenReserve, uint256 wethReserve) = pair.token0() == address(token) ? (r0, r1) : (r1, r0);
        assertEq(tokenReserve, before.lpReserve);
        assertApproxEqRel(wethReserve, GRADUATION_ETH, 0.0001e18);
        // All LP except MINIMUM_LIQUIDITY is held by the burn address.
        assertEq(pair.balanceOf(token.DEAD()), pair.totalSupply() - 1000);
        // The launchpad holds no leftover ETH for this nation.
        assertEq(address(launchpad).balance, launchpad.protocolFeesAccrued());
        // Price continuity: Uniswap opening price ~= final curve price.
        uint256 uniPrice = (wethReserve * 1e18) / tokenReserve;
        assertApproxEqRel(uniPrice, GRADUATION_ETH * 1e18 / before.lpReserve, 0.001e18);
        assertGt(uniPrice, lastPrice);
    }

    function test_GraduatingBuyRefundsExcess() public {
        uint256 balBefore = carol.balance;
        _buy(carol, id, 50 ether);
        AtlasLaunchpad.Nation memory n = launchpad.getNation(id);
        assertTrue(n.graduated);
        uint256 spent = balBefore - carol.balance;
        // ~2 ETH to the curve + 1% fee; the rest refunded
        assertApproxEqRel(spent, (GRADUATION_ETH * 10_000) / 9_900, 0.0001e18);
        assertEq(token.balanceOf(carol), n.curveSupply);
    }

    function test_EmitsGraduated() public {
        vm.expectEmit(true, false, false, false);
        emit AtlasLaunchpad.NationGraduated(id, address(0), 0, 0, 0);
        _buy(carol, id, 50 ether);
    }

    function test_RevertWhen_CurveTradingAfterGraduation() public {
        _graduate(id);
        vm.prank(alice);
        vm.expectRevert(AtlasLaunchpad.NationGraduatedAlready.selector);
        launchpad.buy{value: 1 ether}(id, 0, block.timestamp);
        vm.startPrank(carol);
        token.approve(address(launchpad), 1 ether);
        vm.expectRevert(AtlasLaunchpad.NationGraduatedAlready.selector);
        launchpad.sell(id, 1 ether, 0, block.timestamp);
        vm.stopPrank();
        (uint256 q,,,) = launchpad.quoteBuy(id, 1 ether);
        assertEq(q, 0);
    }

    function test_UniswapTradingAfterGraduation() public {
        _graduate(id);
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(token);
        vm.prank(alice);
        uint256[] memory amounts = router.swapExactETHForTokens{value: 0.1 ether}(0, path, alice, block.timestamp);
        assertEq(token.balanceOf(alice), amounts[1]);
        assertEq(token.delegates(alice), alice);

        path[0] = address(token);
        path[1] = address(weth);
        vm.startPrank(alice);
        token.approve(address(router), amounts[1]);
        uint256 balBefore = alice.balance;
        router.swapExactTokensForETH(amounts[1], 0, path, alice, block.timestamp);
        vm.stopPrank();
        assertGt(alice.balance, balBefore);
    }

    function test_DonatedWethBeforeGraduationOnlyRaisesPrice() public {
        AtlasLaunchpad.Nation memory n = launchpad.getNation(id);
        // Attacker donates WETH into the empty pair and syncs reserves.
        vm.startPrank(alice);
        weth.deposit{value: 1 ether}();
        weth.transfer(n.pair, 1 ether);
        vm.stopPrank();
        UniswapV2Pair(n.pair).sync();
        _graduate(id);
        (uint112 r0, uint112 r1,) = UniswapV2Pair(n.pair).getReserves();
        uint256 wethReserve = UniswapV2Pair(n.pair).token0() == address(weth) ? r0 : r1;
        assertApproxEqRel(wethReserve, GRADUATION_ETH + 1 ether, 0.0001e18);
        assertEq(UniswapV2Pair(n.pair).balanceOf(token.DEAD()), UniswapV2Pair(n.pair).totalSupply() - 1000);
    }

    function test_RevertWhen_SeedingPoolBeforeGraduation() public {
        uint256 out = _buy(alice, id, 0.1 ether);
        address pair = token.pair();
        vm.prank(alice);
        vm.expectRevert(NationToken.PoolLockedUntilGraduation.selector);
        token.transfer(pair, out);
    }
}

contract AtlasLaunchpadFounderVestingTest is BaseTest {
    uint256 internal id;
    NationToken internal token;

    function setUp() public override {
        super.setUp();
        AtlasLaunchpad.FoundingParams memory p = _params("Dogeland", "DOGE");
        p.founderBps = 500;
        (id, token) = _foundWith(p, 0);
    }

    function test_LinearVesting() public {
        uint256 total = SUPPLY / 20;
        assertEq(launchpad.vestedFounderTokens(id), 0);
        vm.warp(block.timestamp + 15 days);
        assertEq(launchpad.vestedFounderTokens(id), total / 2);
        vm.prank(founder);
        assertEq(launchpad.claimFounderTokens(id), total / 2);
        assertEq(token.balanceOf(founder), total / 2);
        vm.warp(block.timestamp + 30 days);
        assertEq(launchpad.vestedFounderTokens(id), total);
        vm.prank(founder);
        assertEq(launchpad.claimFounderTokens(id), total / 2);
        assertEq(token.balanceOf(founder), total);
    }

    function test_RevertWhen_NothingVested() public {
        vm.prank(founder);
        vm.expectRevert(AtlasLaunchpad.NothingToClaim.selector);
        launchpad.claimFounderTokens(id);
    }

    function test_RevertWhen_NotFounder() public {
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(AtlasLaunchpad.NotFounder.selector);
        launchpad.claimFounderTokens(id);
    }

    function test_VestingContinuesAfterGraduation() public {
        _graduate(id);
        vm.warp(block.timestamp + 31 days);
        vm.prank(founder);
        launchpad.claimFounderTokens(id);
        assertEq(token.balanceOf(founder), SUPPLY / 20);
        assertEq(token.balanceOf(address(launchpad)), 0);
    }
}

/// @dev Attempts to re-enter the launchpad when receiving ETH.
contract ReentrantTrader {
    AtlasLaunchpad internal immutable lp;
    uint256 internal immutable id;
    bool internal attack;
    bool public reentered;

    constructor(AtlasLaunchpad lp_, uint256 id_) {
        lp = lp_;
        id = id_;
    }

    function buyThenSell() external payable {
        uint256 out = lp.buy{value: msg.value}(id, 0, block.timestamp);
        NationToken(lp.tokenOf(id)).approve(address(lp), out);
        attack = true;
        lp.sell(id, out / 2, 0, block.timestamp);
    }

    function buy() external payable {
        attack = true;
        lp.buy{value: msg.value}(id, 0, block.timestamp);
    }

    receive() external payable {
        if (attack) {
            attack = false;
            // Re-entry must fail; swallow the revert so the outer call completes.
            try lp.sell(id, 1, 0, block.timestamp) {
                reentered = true;
            } catch {}
            try lp.withdrawProtocolFees() {
                reentered = true;
            } catch {}
        }
    }
}

contract AtlasLaunchpadSecurityTest is BaseTest {
    function test_ReentrancyOnSellBlocked() public {
        (uint256 id,) = _found("Pepeland", "PEPE");
        ReentrantTrader attacker = new ReentrantTrader(launchpad, id);
        attacker.buyThenSell{value: 0.5 ether}();
        assertFalse(attacker.reentered());
        assertEq(address(launchpad).balance, _ethInvariant() + launchpad.protocolFeesAccrued());
    }

    function test_ReentrancyOnGraduationRefundBlocked() public {
        (uint256 id,) = _found("Pepeland", "PEPE");
        ReentrantTrader attacker = new ReentrantTrader(launchpad, id);
        vm.deal(address(this), 100 ether);
        attacker.buy{value: 10 ether}();
        assertFalse(attacker.reentered());
        assertTrue(launchpad.getNation(id).graduated);
    }

    function test_NoTokenMintingPossible() public {
        (, NationToken token) = _found("Pepeland", "PEPE");
        // The only state-changing selectors on NationToken are standard ERC-20/permit/votes + markGraduated.
        (bool ok,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", alice, 1));
        assertFalse(ok);
        vm.prank(alice);
        vm.expectRevert(NationToken.OnlyLaunchpad.selector);
        token.markGraduated();
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_CannotFoundWithReenteringCreationNameCollision() public {
        _found("Pepeland", "PEPE");
        vm.prank(alice);
        vm.expectRevert(AtlasLaunchpad.NameTaken.selector);
        launchpad.foundNation{value: CREATION_FEE}(_params("pepeLAND", "XX"));
    }

    function test_CurvePriceMathMonotonicAcrossGraduationDistances() public {
        (uint256 id,) = _found("Pepeland", "PEPE");
        AtlasLaunchpad.Nation memory n = launchpad.getNation(id);
        uint256 prev;
        for (uint256 i; i < 20; i++) {
            _buy(alice, id, 0.05 ether);
            n = launchpad.getNation(id);
            if (n.graduated) break;
            uint256 price = launchpad.spotPrice(id);
            assertGt(price, prev);
            prev = price;
            // k never decreases (rounding always favours the curve)
            uint256 k0 = n.initialVirtualEth * ((n.curveSupply * n.curveSupply) / (n.curveSupply - (SUPPLY / 5)));
            assertGe(n.virtualEth * n.virtualTokens, k0);
        }
    }
}
