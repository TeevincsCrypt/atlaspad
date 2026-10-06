// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AtlasLaunchpad} from "../src/AtlasLaunchpad.sol";
import {AtlasGovernor} from "../src/AtlasGovernor.sol";
import {NationTreasury} from "../src/NationTreasury.sol";
import {NationToken} from "../src/NationToken.sol";
import {WETH9} from "./mocks/WETH9.sol";
import {UniswapV2Factory, UniswapV2Router02, UniswapV2Pair} from "./mocks/UniswapV2.sol";

abstract contract BaseTest is Test {
    WETH9 internal weth;
    UniswapV2Factory internal v2Factory;
    UniswapV2Router02 internal router;
    NationTreasury internal treasury;
    AtlasGovernor internal governor;
    AtlasLaunchpad internal launchpad;

    address internal feeRecipient = makeAddr("feeRecipient");
    address internal founder = makeAddr("founder");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant GRADUATION_ETH = 2 ether;
    uint256 internal constant CREATION_FEE = 0.001 ether;
    uint256 internal constant SUPPLY = 1_000_000_000 ether;

    function setUp() public virtual {
        vm.warp(1_790_000_000); // a realistic 2026 timestamp
        weth = new WETH9();
        v2Factory = new UniswapV2Factory(address(this));
        router = new UniswapV2Router02(address(v2Factory), address(weth));
        _deployAtlas(GRADUATION_ETH, CREATION_FEE);

        vm.deal(founder, 1_000 ether);
        vm.deal(alice, 1_000 ether);
        vm.deal(bob, 1_000 ether);
        vm.deal(carol, 1_000 ether);
    }

    /// @dev Mirrors script/Deploy.s.sol: predict CREATE addresses so every reference is immutable.
    function _deployAtlas(uint256 graduationEth, uint256 creationFee) internal {
        uint64 nonce = vm.getNonce(address(this));
        address predictedTreasury = vm.computeCreateAddress(address(this), nonce);
        address predictedGovernor = vm.computeCreateAddress(address(this), nonce + 1);
        address predictedLaunchpad = vm.computeCreateAddress(address(this), nonce + 2);

        treasury = new NationTreasury(predictedLaunchpad, predictedGovernor);
        governor = new AtlasGovernor(predictedLaunchpad, predictedTreasury);
        launchpad = new AtlasLaunchpad(
            address(v2Factory),
            address(weth),
            address(treasury),
            address(governor),
            feeRecipient,
            graduationEth,
            creationFee
        );
        assertEq(address(treasury), predictedTreasury);
        assertEq(address(governor), predictedGovernor);
        assertEq(address(launchpad), predictedLaunchpad);
    }

    function _params(string memory name, string memory symbol) internal pure returns (AtlasLaunchpad.FoundingParams memory p) {
        p.name = name;
        p.symbol = symbol;
        p.description = "A nation of frogs.";
        p.metadataURI = "";
        p.theme = 5;
        p.emblem = 0x1234;
        p.totalSupply = SUPPLY;
        p.founderBps = 0;
        p.minTokensOut = 0;
    }

    function _found(string memory name, string memory symbol) internal returns (uint256 id, NationToken token) {
        return _foundWith(_params(name, symbol), 0);
    }

    function _foundWith(AtlasLaunchpad.FoundingParams memory p, uint256 initialBuy)
        internal
        returns (uint256 id, NationToken token)
    {
        vm.prank(founder);
        (uint256 nid, address t) = launchpad.foundNation{value: CREATION_FEE + initialBuy}(p);
        return (nid, NationToken(t));
    }

    function _buy(address who, uint256 id, uint256 ethIn) internal returns (uint256 out) {
        vm.prank(who);
        out = launchpad.buy{value: ethIn}(id, 0, block.timestamp);
    }

    function _sell(address who, uint256 id, uint256 amount) internal returns (uint256 out) {
        AtlasLaunchpad.Nation memory n = launchpad.getNation(id);
        vm.startPrank(who);
        NationToken(n.token).approve(address(launchpad), amount);
        out = launchpad.sell(id, amount, 0, block.timestamp);
        vm.stopPrank();
    }

    /// @dev Buys until the curve sells out (graduation).
    function _graduate(uint256 id) internal {
        AtlasLaunchpad.Nation memory n = launchpad.getNation(id);
        while (!n.graduated) {
            _buy(carol, id, 1 ether);
            n = launchpad.getNation(id);
        }
    }

    function _ethInvariant() internal view returns (uint256 sumRealEth) {
        uint256 count = launchpad.nationCount();
        for (uint256 i = 1; i <= count; i++) {
            sumRealEth += launchpad.getNation(i).realEth;
        }
    }
}
