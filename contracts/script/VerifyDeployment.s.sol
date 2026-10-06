// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {AtlasLaunchpad} from "../src/AtlasLaunchpad.sol";
import {AtlasGovernor} from "../src/AtlasGovernor.sol";
import {NationTreasury} from "../src/NationTreasury.sol";
import {IUniswapV2Router02} from "../src/interfaces/IUniswapV2Router02.sol";

/// @notice Read-only verification of a recorded deployment (deployments/<chainId>.json) against the live chain.
///   forge script script/VerifyDeployment.s.sol --rpc-url robinhood
contract VerifyDeployment is Script {
    using stdJson for string;

    function run() external view {
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        string memory json = vm.readFile(path);
        require(json.readUint(".chainId") == block.chainid, "chain id mismatch");

        AtlasLaunchpad launchpad = AtlasLaunchpad(payable(json.readAddress(".launchpad")));
        AtlasGovernor governor = AtlasGovernor(json.readAddress(".governor"));
        NationTreasury treasury = NationTreasury(payable(json.readAddress(".treasury")));
        address factory = json.readAddress(".uniswapV2Factory");
        address router = json.readAddress(".uniswapV2Router");
        address weth = json.readAddress(".weth");

        require(address(launchpad).code.length > 0, "launchpad: no code");
        require(address(governor).code.length > 0, "governor: no code");
        require(address(treasury).code.length > 0, "treasury: no code");
        require(launchpad.uniswapV2Factory() == factory, "launchpad.factory");
        require(launchpad.weth() == weth, "launchpad.weth");
        require(IUniswapV2Router02(router).factory() == factory, "router.factory");
        require(IUniswapV2Router02(router).WETH() == weth, "router.WETH");
        require(address(launchpad.treasury()) == address(treasury), "launchpad.treasury");
        require(launchpad.governor() == address(governor), "launchpad.governor");
        require(address(treasury.launchpad()) == address(launchpad), "treasury.launchpad");
        require(treasury.governor() == address(governor), "treasury.governor");
        require(address(governor.launchpad()) == address(launchpad), "governor.launchpad");
        require(address(governor.treasury()) == address(treasury), "governor.treasury");
        require(launchpad.protocolFeeRecipient() == json.readAddress(".protocolFeeRecipient"), "fee recipient");
        require(address(launchpad.tokenFactory()) == json.readAddress(".tokenFactory"), "token factory");
        // ">=": ETH can be forced into any contract (e.g. SELFDESTRUCT) without passing its accounting.
        require(address(treasury).balance >= treasury.totalHeld(), "treasury solvency");

        uint256 count = launchpad.nationCount();
        uint256 reserves;
        for (uint256 i = 1; i <= count; i++) {
            reserves += launchpad.getNation(i).realEth;
        }
        require(address(launchpad).balance >= reserves + launchpad.protocolFeesAccrued(), "launchpad solvency");

        console2.log("Deployment verified on chain", block.chainid);
        console2.log("Nations founded:", count);
        console2.log("Proposals:", governor.proposalCount());
        console2.log("Treasury ETH held:", treasury.totalHeld());
    }
}
