// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {AtlasLaunchpad} from "../src/AtlasLaunchpad.sol";
import {AtlasGovernor} from "../src/AtlasGovernor.sol";
import {NationTreasury} from "../src/NationTreasury.sol";
import {IUniswapV2Router02} from "../src/interfaces/IUniswapV2Router02.sol";
import {IUniswapV2Factory} from "../src/interfaces/IUniswapV2Factory.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice Production deployment of AtlasPad.
///
/// Required environment (see ENVIRONMENT.md and the repository-root .env.example; Foundry auto-loads contracts/.env):
///   EXPECTED_CHAIN_ID        4663 for Robinhood Chain mainnet
///   UNISWAP_V2_FACTORY       0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f (Robinhood Chain)
///   UNISWAP_V2_ROUTER        0x89e5db8b5aa49aa85ac63f691524311aeb649eba (Robinhood Chain)
///   WIF_ADDRESS              0x5173b8eA6923c2d40267890D45C46a3480954773 ($WIF on Robinhood Chain)
///   PROTOCOL_FEE_RECIPIENT   recommended: a multisig (e.g. Safe)
///   GRADUATION_WIF           $WIF base units the curve raises before graduating, e.g. 1000000000000000000000000
///                            (1,000,000 WIF at 18 decimals)
///   CREATION_FEE_WIF         $WIF base units burned per founding, e.g. 1000000000000000000000 (1,000 WIF)
///
/// Run (keystore account, never a raw private key in shell history):
///   forge script script/Deploy.s.sol --rpc-url robinhood --account deployer --broadcast --verify \
///     --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
contract Deploy is Script {
    struct Config {
        uint256 expectedChainId;
        address factory;
        address router;
        address wif;
        address feeRecipient;
        uint256 graduationWif;
        uint256 creationFee;
    }

    function run() external virtual {
        Config memory c = Config({
            expectedChainId: vm.envUint("EXPECTED_CHAIN_ID"),
            factory: vm.envAddress("UNISWAP_V2_FACTORY"),
            router: vm.envAddress("UNISWAP_V2_ROUTER"),
            wif: vm.envAddress("WIF_ADDRESS"),
            feeRecipient: vm.envAddress("PROTOCOL_FEE_RECIPIENT"),
            graduationWif: vm.envUint("GRADUATION_WIF"),
            creationFee: vm.envUint("CREATION_FEE_WIF")
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

        treasury = new NationTreasury(predictedLaunchpad, predictedGovernor, c.wif);
        governor = new AtlasGovernor(predictedLaunchpad, predictedTreasury);
        launchpad = new AtlasLaunchpad(
            c.factory, c.wif, address(treasury), address(governor), c.feeRecipient, c.graduationWif, c.creationFee
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
        require(c.wif.code.length > 0, "wif has no code");
        require(IUniswapV2Router02(c.router).factory() == c.factory, "router.factory() mismatch");
        // getPair must be callable (reverts if the address is not a V2 factory)
        IUniswapV2Factory(c.factory).getPair(c.wif, address(0xdead));
        // $WIF must look like an ERC-20 (reverts otherwise); log what we are about to build on.
        console2.log("WIF token", IERC20Metadata(c.wif).symbol(), IERC20Metadata(c.wif).decimals());
        console2.log("WIF total supply", IERC20Metadata(c.wif).totalSupply());
        require(c.feeRecipient != address(0), "fee recipient not set");
        require(c.graduationWif >= 1e6 && c.graduationWif <= 1e36, "graduation out of bounds");
        require(c.creationFee <= c.graduationWif, "creation fee too high");
        console2.log("Preflight OK on chain", block.chainid);
    }

    function postflight(Config memory c, AtlasLaunchpad launchpad, AtlasGovernor governor, NationTreasury treasury)
        public
        view
    {
        require(launchpad.uniswapV2Factory() == c.factory, "launchpad factory");
        require(address(launchpad.wif()) == c.wif, "launchpad wif");
        require(address(treasury.wif()) == c.wif, "treasury wif");
        require(address(launchpad.treasury()) == address(treasury), "launchpad treasury");
        require(launchpad.governor() == address(governor), "launchpad governor");
        require(launchpad.protocolFeeRecipient() == c.feeRecipient, "launchpad fee recipient");
        require(launchpad.graduationWif() == c.graduationWif, "launchpad graduation");
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
        // The block number the script saw before broadcasting. Confirm ATLAS_DEPLOY_BLOCK against the broadcast
        // receipts in broadcast/ (exact blocks); on Arbitrum-based chains block.number semantics differ.
        vm.serializeUint(obj, "deployedAtBlock", block.number);
        vm.serializeUint(obj, "deployedAtTimestamp", block.timestamp);
        vm.serializeAddress(obj, "deployer", deployer);
        vm.serializeAddress(obj, "launchpad", address(launchpad));
        vm.serializeAddress(obj, "governor", address(governor));
        vm.serializeAddress(obj, "treasury", address(treasury));
        vm.serializeAddress(obj, "tokenFactory", address(launchpad.tokenFactory()));
        vm.serializeAddress(obj, "uniswapV2Factory", c.factory);
        vm.serializeAddress(obj, "uniswapV2Router", c.router);
        vm.serializeAddress(obj, "wif", c.wif);
        vm.serializeAddress(obj, "protocolFeeRecipient", c.feeRecipient);
        vm.serializeString(obj, "graduationWif", vm.toString(c.graduationWif));
        string memory json = vm.serializeString(obj, "creationFeeWif", vm.toString(c.creationFee));
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
