// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {IUniswapV2Factory} from "./interfaces/IUniswapV2Factory.sol";

/// @title NationToken
/// @notice The ERC-20 currency of an AtlasPad nation.
///
/// Properties (all verifiable on-chain):
///  - The entire fixed supply is minted once, in the constructor, to the AtlasLaunchpad. There is no
///    mint function, no owner, no pause, no blacklist, no transfer tax and no upgradeability.
///  - Voting power (ERC20Votes, timestamp clock) powers on-chain national governance. Holders are
///    automatically self-delegated the first time they receive tokens, so citizens can vote without an
///    extra transaction. System addresses (launchpad, Uniswap pair, burn address) are never delegated.
///  - The only privileged action in this contract is `markGraduated()`, callable exactly once and only by
///    the launchpad that deployed it. Before graduation, tokens cannot be sent to the token/WIF Uniswap V2
///    pair. This prevents anyone from seeding the pool at a manipulated price before the bonding curve
///    migrates its liquidity. After graduation the token is a plain ERC-20.
contract NationToken is ERC20, ERC20Permit, ERC20Votes {
    /// @notice Conventional burn address. LP tokens are sent here at graduation.
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    /// @notice The AtlasPad nation id this token belongs to.
    uint256 public immutable nationId;
    /// @notice The AtlasLaunchpad that founded this nation and holds the unsold supply.
    address public immutable launchpad;
    /// @notice The token/WIF Uniswap V2 pair liquidity migrates into at graduation.
    address public immutable pair;

    /// @notice True once the bonding curve has migrated liquidity to Uniswap V2.
    bool public graduated;

    event Graduated(address indexed pair);

    error PoolLockedUntilGraduation();
    error OnlyLaunchpad();
    error AlreadyGraduated();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 nationId_,
        uint256 totalSupply_,
        address launchpad_,
        address uniswapV2Factory,
        address wif
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        launchpad = launchpad_;
        nationId = nationId_;
        // The pair may already exist if someone pre-computed this address and created it; that is harmless
        // because nobody can deposit this token into it before graduation.
        address existing = IUniswapV2Factory(uniswapV2Factory).getPair(address(this), wif);
        pair = existing != address(0) ? existing : IUniswapV2Factory(uniswapV2Factory).createPair(address(this), wif);
        _mint(launchpad_, totalSupply_);
    }

    /// @notice Called once by the launchpad immediately before it seeds the Uniswap V2 pool.
    function markGraduated() external {
        if (msg.sender != launchpad) revert OnlyLaunchpad();
        if (graduated) revert AlreadyGraduated();
        graduated = true;
        emit Graduated(pair);
    }

    // ---------------------------------------------------------------------------------------------
    // ERC-6372 clock: timestamps. Robinhood Chain is an Arbitrum Orbit chain where `block.number`
    // tracks the parent chain, so timestamps are the reliable clock for governance snapshots.
    // ---------------------------------------------------------------------------------------------

    function clock() public view override returns (uint48) {
        return uint48(block.timestamp);
    }

    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    // ---------------------------------------------------------------------------------------------
    // Transfer hook
    // ---------------------------------------------------------------------------------------------

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes) {
        if (to == pair && !graduated) revert PoolLockedUntilGraduation();
        super._update(from, to, value);
        if (
            value != 0 && to != address(0) && to != launchpad && to != pair && to != DEAD
                && delegates(to) == address(0)
        ) {
            _delegate(to, to);
        }
    }

    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
