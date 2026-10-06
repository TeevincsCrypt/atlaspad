// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {NationToken} from "./NationToken.sol";

/// @title NationTokenFactory
/// @notice Deploys NationToken contracts for AtlasLaunchpad (CREATE2, salt = nation id).
/// Deployed by the launchpad in its own constructor; only that launchpad can use it. It exists so the
/// NationToken creation code does not count against the launchpad's 24 KB runtime size limit.
contract NationTokenFactory {
    address public immutable launchpad;

    error OnlyLaunchpad();

    constructor() {
        launchpad = msg.sender;
    }

    function deploy(
        string calldata name,
        string calldata symbol,
        uint256 nationId,
        uint256 totalSupply,
        address uniswapV2Factory,
        address weth
    ) external returns (address token) {
        if (msg.sender != launchpad) revert OnlyLaunchpad();
        token = address(
            new NationToken{salt: bytes32(nationId)}(
                name, symbol, nationId, totalSupply, launchpad, uniswapV2Factory, weth
            )
        );
    }
}
