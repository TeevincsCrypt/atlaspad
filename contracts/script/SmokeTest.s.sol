// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {AtlasLaunchpad} from "../src/AtlasLaunchpad.sol";
import {NationToken} from "../src/NationToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Post-deployment smoke test with the smallest safe amounts: founds a nation with a tiny initial buy,
/// buys again, then sells half back. THIS SPENDS REAL $WIF ON MAINNET (the creation fee is burned, plus the two
/// buys) and ETH for gas, and creates a real, permanent nation. Every step is a real $WIF transaction. It requires SMOKE_CONFIRM=I_UNDERSTAND on any chain other than anvil.
///
///   SMOKE_NAME="Atlas Test" SMOKE_SYMBOL=ATEST SMOKE_CONFIRM=I_UNDERSTAND \
///   forge script script/SmokeTest.s.sol --rpc-url robinhood --account deployer --broadcast
contract SmokeTest is Script {
    using stdJson for string;

    function run() external {
        if (block.chainid != 31337) {
            require(
                keccak256(bytes(vm.envOr("SMOKE_CONFIRM", string("")))) == keccak256("I_UNDERSTAND"),
                "set SMOKE_CONFIRM=I_UNDERSTAND to spend real funds"
            );
        }
        string memory json =
            vm.readFile(string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json"));
        AtlasLaunchpad launchpad = AtlasLaunchpad(payable(json.readAddress(".launchpad")));

        AtlasLaunchpad.FoundingParams memory p;
        p.name = vm.envOr("SMOKE_NAME", string("Atlas Smoke Test"));
        p.symbol = vm.envOr("SMOKE_SYMBOL", string("SMOKE"));
        p.description = "Deployment smoke test nation.";
        p.theme = 6;
        p.emblem = uint256(keccak256(bytes(p.name)));
        p.totalSupply = 1_000_000_000 ether;
        p.founderBps = 0;

        // $WIF base units. Defaults assume 18 decimals: 100 WIF initial buy, 200 WIF second buy.
        uint256 initialBuy = vm.envOr("SMOKE_INITIAL_BUY_WIF", uint256(100 ether));
        uint256 secondBuy = vm.envOr("SMOKE_BUY_WIF", uint256(200 ether));
        p.initialBuyWif = initialBuy;
        IERC20 wif = launchpad.wif();

        vm.startBroadcast();
        (, address me,) = vm.readCallers();
        uint256 wifBefore = wif.balanceOf(me);
        wif.approve(address(launchpad), launchpad.creationFee() + initialBuy + secondBuy);
        (uint256 id, address token) = launchpad.foundNation(p);
        launchpad.buy(id, secondBuy, 0, block.timestamp + 10 minutes);
        uint256 bal = NationToken(token).balanceOf(me);
        NationToken(token).approve(address(launchpad), bal / 2);
        uint256 wifBack = launchpad.sell(id, bal / 2, 0, block.timestamp + 10 minutes);
        vm.stopBroadcast();

        AtlasLaunchpad.Nation memory n = launchpad.getNation(id);
        require(n.founder == me, "founder");
        require(NationToken(token).balanceOf(me) == bal - bal / 2, "balance");
        require(NationToken(token).getVotes(me) == bal - bal / 2, "votes");
        console2.log("Smoke nation id", id);
        console2.log("Token", token);
        console2.log("WIF spent (net)", wifBefore - wif.balanceOf(me));
        console2.log("WIF returned from sell", wifBack);
        console2.log("Curve WIF reserve", n.realWif);
        console2.log("WIF burned by this nation", launchpad.wifBurnedOf(id));
    }
}
