// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {Deploy} from "./Deploy.s.sol";
import {WETH9} from "../test/mocks/WETH9.sol";
import {MockWIF} from "../test/mocks/MockWIF.sol";
import {UniswapV2Factory, UniswapV2Router02} from "../test/mocks/UniswapV2.sol";

/// @notice LOCAL DEVELOPMENT ONLY (anvil, chain id 31337). Deploys WETH9, Uniswap V2 ports and a freely mintable
/// stand-in for $WIF, mints 10,000,000 WIF to the first ten anvil accounts, then deploys AtlasPad.
/// Refuses to run on any other chain.
///   anvil &
///   forge script script/DeployLocal.s.sol --rpc-url local --broadcast \
///     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
contract DeployLocal is Deploy {
    /// @dev The first ten default anvil accounts ("test test ... junk" mnemonic).
    address[10] internal anvilAccounts = [
        0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266,
        0x70997970C51812dc3A010C7d01b50e0d17dc79C8,
        0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,
        0x90F79bf6EB2c4f870365E785982E1f101E93b906,
        0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65,
        0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc,
        0x976EA74026E726554dB657fA54763abd0C3a0aa9,
        0x14dC79964da2C08b23698B3D3cc7Ca32193d9955,
        0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f,
        0xa0Ee7A142d267C1f36714E4a8F75612F20a79720
    ];

    function run() external override {
        require(block.chainid == 31337, "DeployLocal is for anvil (31337) only");
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        WETH9 weth = new WETH9();
        MockWIF wif = new MockWIF();
        UniswapV2Factory factory = new UniswapV2Factory(deployer);
        UniswapV2Router02 router = new UniswapV2Router02(address(factory), address(weth));
        for (uint256 i; i < anvilAccounts.length; i++) {
            wif.mint(anvilAccounts[i], 10_000_000 ether);
        }
        vm.stopBroadcast();
        console2.log("Local WETH9", address(weth));
        console2.log("Local MockWIF", address(wif));
        console2.log("Local UniswapV2Factory", address(factory));
        console2.log("Local UniswapV2Router02", address(router));

        deploy(
            Config({
                expectedChainId: 31337,
                factory: address(factory),
                router: address(router),
                wif: address(wif),
                feeRecipient: deployer,
                // LOCAL_* so that production values in contracts/.env never leak into local deployments.
                graduationWif: vm.envOr("LOCAL_GRADUATION_WIF", uint256(100_000 ether)),
                creationFee: vm.envOr("LOCAL_CREATION_FEE_WIF", uint256(100 ether))
            })
        );
    }
}
