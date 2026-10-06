// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {Deploy} from "./Deploy.s.sol";
import {WETH9} from "../test/mocks/WETH9.sol";
import {UniswapV2Factory, UniswapV2Router02} from "../test/mocks/UniswapV2.sol";

/// @notice LOCAL DEVELOPMENT ONLY (anvil, chain id 31337). Deploys WETH9 and Uniswap V2 ports, then AtlasPad.
/// Refuses to run on any other chain.
///   anvil &
///   forge script script/DeployLocal.s.sol --rpc-url local --broadcast \
///     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
contract DeployLocal is Deploy {
    function run() external override {
        require(block.chainid == 31337, "DeployLocal is for anvil (31337) only");
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        WETH9 weth = new WETH9();
        UniswapV2Factory factory = new UniswapV2Factory(deployer);
        UniswapV2Router02 router = new UniswapV2Router02(address(factory), address(weth));
        vm.stopBroadcast();
        console2.log("Local WETH9", address(weth));
        console2.log("Local UniswapV2Factory", address(factory));
        console2.log("Local UniswapV2Router02", address(router));

        deploy(
            Config({
                expectedChainId: 31337,
                factory: address(factory),
                router: address(router),
                weth: address(weth),
                feeRecipient: deployer,
                // LOCAL_* so that production values in contracts/.env never leak into local deployments.
                graduationEth: vm.envOr("LOCAL_GRADUATION_ETH_WEI", uint256(2 ether)),
                creationFee: vm.envOr("LOCAL_CREATION_FEE_WEI", uint256(0))
            })
        );
    }
}
