// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {AtlasLaunchpad} from "../src/AtlasLaunchpad.sol";
import {AtlasGovernor} from "../src/AtlasGovernor.sol";
import {NationTreasury} from "../src/NationTreasury.sol";
import {IUniswapV2Router02} from "../src/interfaces/IUniswapV2Router02.sol";
import {IUniswapV2Factory} from "../src/interfaces/IUniswapV2Factory.sol";

/// @notice Production deployment of AtlasPad.
///
/// Required environment (see ENVIRONMENT.md and the repository-root .env.example; Foundry auto-loads contracts/.env):
///   EXPECTED_CHAIN_ID        4663 for Robinhood Chain mainnet
///   UNISWAP_V2_FACTORY       0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f (Robinhood Chain)
///   UNISWAP_V2_ROUTER        0x89e5db8b5aa49aa85ac63f691524311aeb649eba (Robinhood Chain)
///   WETH_ADDRESS             0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 (Robinhood Chain)
///   PROTOCOL_FEE_RECIPIENT   recommended: a multisig (e.g. Safe)
///   GRADUATION_ETH_WEI       e.g. 2000000000000000000 (2 ETH)
///   CREATION_FEE_WEI         e.g. 0
///
/// Run (keystore account, never a raw private key in shell history):
///   forge script script/Deploy.s.sol --rpc-url robinhood --account deployer --broadcast --verify \
///     --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
contract Deploy is Script {
    struct Config {
        uint256 expectedChainId;
        address factory;
        address router;
        address weth;
        address feeRecipient;
        uint256 graduationEth;
        uint256 creationFee;
    }

    function run() external virtual {
        Config memory c = Config({
            expectedChainId: vm.envUint("EXPECTED_CHAIN_ID"),
            factory: vm.envAddress("UNISWAP_V2_FACTORY"),
            router: vm.envAddress("UNISWAP_V2_ROUTER"),
            weth: vm.envAddress("WETH_ADDRESS"),
            feeRecipient: vm.envAddress("PROTOCOL_FEE_RECIPIENT"),
            graduationEth: vm.envUint("GRADUATION_ETH_WEI"),
            creationFee: vm.envUint("CREATION_FEE_WEI")
        });
        deploy(c);
    }

    function deploy(Config memory c)
        public
        returns (AtlasLaunchpad launchpad, AtlasGovernor governor, NationTreasury treasury)
    {
        preflight(c);

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        uint64 nonce = vm.getNonce(deployer);
        address predictedTreasury = vm.computeCreateAddress(deployer, nonce);
        address predictedGovernor = vm.computeCreateAddress(deployer, nonce + 1);
        address predictedLaunchpad = vm.computeCreateAddress(deployer, nonce + 2);

        treasury = new NationTreasury(predictedLaunchpad, predictedGovernor);
        governor = new AtlasGovernor(predictedLaunchpad, predictedTreasury);
        launchpad = new AtlasLaunchpad(
            c.factory, c.weth, address(treasury), address(governor), c.feeRecipient, c.graduationEth, c.creationFee
        );
        vm.stopBroadcast();

        require(address(treasury) == predictedTreasury, "treasury address mismatch");
        require(address(governor) == predictedGovernor, "governor address mismatch");
        require(address(launchpad) == predictedLaunchpad, "launchpad address mismatch");
        postflight(c, launchpad, governor, treasury);
        record(c, deployer, launchpad, governor, treasury);
    }

    /// @notice Verify the chain and the external infrastructure before spending gas.
    function preflight(Config memory c) public view {
        require(block.chainid == c.expectedChainId, "unexpected chain id");
        require(c.factory.code.length > 0, "factory has no code");
        require(c.router.code.length > 0, "router has no code");
        require(c.weth.code.length > 0, "weth has no code");
        require(IUniswapV2Router02(c.router).factory() == c.factory, "router.factory() mismatch");
        require(IUniswapV2Router02(c.router).WETH() == c.weth, "router.WETH() mismatch");
        // getPair must be callable (reverts if the address is not a V2 factory)
        IUniswapV2Factory(c.factory).getPair(c.weth, address(0xdead));
        require(c.feeRecipient != address(0), "fee recipient not set");
        require(c.graduationEth >= 0.01 ether && c.graduationEth <= 10_000 ether, "graduation out of bounds");
        require(c.creationFee <= 1 ether, "creation fee too high");
        console2.log("Preflight OK on chain", block.chainid);
    }

    function postflight(Config memory c, AtlasLaunchpad launchpad, AtlasGovernor governor, NationTreasury treasury)
        public
        view
    {
        require(launchpad.uniswapV2Factory() == c.factory, "launchpad factory");
        require(launchpad.weth() == c.weth, "launchpad weth");
        require(address(launchpad.treasury()) == address(treasury), "launchpad treasury");
        require(launchpad.governor() == address(governor), "launchpad governor");
        require(launchpad.protocolFeeRecipient() == c.feeRecipient, "launchpad fee recipient");
        require(launchpad.graduationEth() == c.graduationEth, "launchpad graduation");
        require(launchpad.creationFee() == c.creationFee, "launchpad creation fee");
        require(launchpad.tokenFactory().launchpad() == address(launchpad), "token factory");
        require(address(treasury.launchpad()) == address(launchpad), "treasury launchpad");
        require(treasury.governor() == address(governor), "treasury governor");
        require(address(governor.launchpad()) == address(launchpad), "governor launchpad");
        require(address(governor.treasury()) == address(treasury), "governor treasury");
        require(launchpad.nationCount() == 0, "fresh launchpad");
        console2.log("Postflight OK");
    }

    function record(
        Config memory c,
        address deployer,
        AtlasLaunchpad launchpad,
        AtlasGovernor governor,
        NationTreasury treasury
    ) internal {
        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        // The block the script saw before broadcasting: a safe lower bound for ATLAS_DEPLOY_BLOCK (the contracts
        // land a few blocks later; the broadcast receipts in broadcast/ have the exact blocks).
        vm.serializeUint(obj, "deployedAtBlock", block.number);
        vm.serializeUint(obj, "deployedAtTimestamp", block.timestamp);
        vm.serializeAddress(obj, "deployer", deployer);
        vm.serializeAddress(obj, "launchpad", address(launchpad));
        vm.serializeAddress(obj, "governor", address(governor));
        vm.serializeAddress(obj, "treasury", address(treasury));
        vm.serializeAddress(obj, "tokenFactory", address(launchpad.tokenFactory()));
        vm.serializeAddress(obj, "uniswapV2Factory", c.factory);
        vm.serializeAddress(obj, "uniswapV2Router", c.router);
        vm.serializeAddress(obj, "weth", c.weth);
        vm.serializeAddress(obj, "protocolFeeRecipient", c.feeRecipient);
        vm.serializeString(obj, "graduationEthWei", vm.toString(c.graduationEth));
        string memory json = vm.serializeString(obj, "creationFeeWei", vm.toString(c.creationFee));
        // Only a broadcast run records the deployment; a dry run's addresses are predictions, kept separately.
        bool broadcast = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        string memory path = string.concat(
            vm.projectRoot(), "/deployments/", vm.toString(block.chainid), broadcast ? ".json" : ".dry-run.json"
        );
        vm.writeJson(json, path);
        console2.log(broadcast ? "Deployment recorded at" : "DRY RUN (nothing deployed); predicted addresses at", path);
        console2.log("AtlasLaunchpad", address(launchpad));
        console2.log("AtlasGovernor ", address(governor));
        console2.log("NationTreasury", address(treasury));
    }
}
