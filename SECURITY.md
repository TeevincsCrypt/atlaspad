# Security

This document describes AtlasPad's security model: who can do what, where every fee goes, what the contracts
enforce, what they do not, and how to report a vulnerability. Every statement is based on the code in this
repository. For function-level detail, see [CONTRACTS.md](CONTRACTS.md).

> **Status as of 2026-10-06**
>
> - **The contracts have NOT been externally audited.** No audit report exists, and this repository does not
>   define a bug bounty program.
> - **The contracts are not deployed on Robinhood Chain mainnet yet.** The deployment could not be performed from
>   the development sandbox, whose network egress could not reach the Robinhood Chain RPC. No mainnet addresses are
>   recorded. After deployment they will be in `contracts/deployments/4663.json`.
> - **Found a vulnerability?** Report it privately. See [Reporting a vulnerability](#13-reporting-a-vulnerability).

Interacting with these contracts involves real risk, including total loss of funds. Nothing here is a promise of
value or profit.

## Contents

1. [Audit status and scope](#1-audit-status-and-scope)
2. [Trust model](#2-trust-model)
3. [Fee transparency](#3-fee-transparency)
4. [Founder allocation limits and vesting](#4-founder-allocation-limits-and-vesting)
5. [Treasury controls](#5-treasury-controls)
6. [Governance protections](#6-governance-protections)
7. [Re-entrancy and external calls](#7-re-entrancy-and-external-calls)
8. [Slippage and deadline protection](#8-slippage-and-deadline-protection)
9. [Pre-graduation pair-transfer lock](#9-pre-graduation-pair-transfer-lock)
10. [Known limitations and risks](#10-known-limitations-and-risks)
11. [Off-chain components](#11-off-chain-components)
12. [Pre-deployment checklist](#12-pre-deployment-checklist)
13. [Reporting a vulnerability](#13-reporting-a-vulnerability)

---

## 1. Audit status and scope

- **No external audit.** All assurance so far comes from the project's own Foundry test suite: 107 tests (unit,
  fuzz and stateful invariant tests) that all pass as of 2026-10-06. Tests are not a substitute for an audit.
- **On-chain scope:** `contracts/src/AtlasLaunchpad.sol`, `NationTokenFactory.sol`, `NationToken.sol`,
  `NationTreasury.sol`, `AtlasGovernor.sol` and `contracts/src/interfaces/*`.
- **Toolchain:** Solidity `0.8.28` (checked arithmetic) and OpenZeppelin Contracts v5.6.1 (`ERC20`, `ERC20Permit`,
  `ERC20Votes`, `ReentrancyGuard`, `SafeERC20`, `Math`).
- **External dependencies:** the Uniswap V2 factory and pair contracts and WETH9 on Robinhood Chain, used at
  graduation. AtlasPad does not control them.
- **Off-chain components** (web app and indexer) are covered in [§11](#11-off-chain-components). They hold no
  keys and cannot move funds. Users who transact through the web app do rely on it to build correct transactions,
  so check the contract address and details in your wallet before signing.

---

## 2. Trust model

### Verified properties

Each row was checked against the source.

| Property | Holds? | How it is enforced |
|---|---|---|
| No owner or admin key | Yes | No contract has an owner variable or uses `Ownable` or `AccessControl`. The contracts keep no reference to the deployer. |
| No upgradeability | Yes | No proxies, no `delegatecall`, no `selfdestruct`. Every contract is deployed with `new` / CREATE2 and its code is final. |
| No hidden mint | Yes | `_mint` is called only once, in the `NationToken` constructor, minting the whole fixed supply to the launchpad. There is no mint or burn function (`test_NoTokenMintingPossible`). |
| No pause, blacklist or transfer tax | Yes | No such logic exists. The only restriction in the token transfer hook is the pre-graduation pair lock ([§9](#9-pre-graduation-pair-transfer-lock)), which `markGraduated()` lifts for good. |
| Parameters cannot change | Yes | All configuration is `immutable` (set in constructors) or `constant`. No setters exist. |
| Nation $WIF is kept separate | Yes | Curve $WIF is tracked per nation (`realWif`). A sell cannot pay more than that nation's `realWif`. Treasury balances are per nation. |
| Founder-allocation tokens never reach the curve | Yes | `claimFounderTokens` reverts with `NotGraduated` before graduation, and the curve is closed after it (`test_RevertWhen_FounderTokensClaimedBeforeGraduation`). |

Immutability has a cost. If a bug is found, nobody can patch the contracts, pause them, or rescue stuck funds.

### Privileged roles

| Role | Holder | Can | Cannot |
|---|---|---|---|
| Protocol fee recipient | `protocolFeeRecipient`, an immutable address chosen at deployment | Receive accrued protocol fees (the 0.25% protocol share of curve fees, in $WIF) when **anyone** calls `withdrawProtocolFees()` | Call any restricted function. Its address is never checked as `msg.sender` anywhere. It cannot change fees or parameters, touch curve reserves, treasuries or tokens, or redirect fees elsewhere. |
| AtlasGovernor (contract) | Immutable reference in the launchpad and treasury | Call `NationTreasury.release` (max 25% of a nation's balance per 7-day window) and `AtlasLaunchpad.setNationSymbol`, and only while executing a passed proposal | Mint tokens, move user tokens, touch curve $WIF or protocol fees, change any parameter |
| AtlasLaunchpad (contract) | Immutable reference in tokens, factory, treasury and governor | Call `NationToken.markGraduated()` (once per token) and `NationTokenFactory.deploy`, and deposit into the treasury | Release treasury funds or mint tokens beyond the constructor mint |
| Nation founder | `msg.sender` of `foundNation`, fixed forever | Claim their vested founder allocation, once the nation has graduated | Claim before graduation (`NotGraduated`), sell founder tokens into the bonding curve, change nation parameters, take curve $WIF except by selling curve-bought tokens like anyone else, or transfer the founder role |
| Proposer | Account that created a proposal | Cancel their own proposal while voting is open | Cancel anyone else's proposal, or cancel after voting ends |
| Deployer | Account that runs `Deploy.s.sol` | Choose the immutable parameters once: Uniswap factory, $WIF token, fee recipient, `graduationWif` (`1e6`–`1e36` base units) and `creationFee` (≤ `graduationWif`) | Do anything after deployment |

---

## 3. Fee transparency

| Fee | Amount | Charged on | Destination | How it can leave |
|---|---|---|---|---|
| Creation fee | `creationFee()`: immutable $WIF amount, 0 to `graduationWif`, chosen at deployment | `foundNation` | **Burned**: sent to `0x…dEaD` in the founding transaction (`WifBurned`, `creationFee = true`) | Never |
| Curve trade fee, treasury share | 0.5% of trade value (`fee × 50 / 100`, rounded down) | Every bonding-curve buy and sell | Deposited immediately into `NationTreasury` for that nation | Only through executed Treasury proposals ([§5](#5-treasury-controls)) |
| Curve trade fee, burn share | 0.25% of trade value (`fee × 25 / 100`, rounded down) | Every bonding-curve buy and sell | **Burned**: sent to `0x…dEaD` in the same transaction (`WifBurned`) | Never |
| Curve trade fee, protocol share | 0.25% of trade value (`fee − treasury − burn`, including the rounding remainder) | Every bonding-curve buy and sell | `protocolFeesAccrued`, held in the launchpad | `withdrawProtocolFees()`, callable by anyone, pays only `protocolFeeRecipient` |

The total curve fee is 1% (`TRADE_FEE_BPS = 100`), charged in $WIF:

- **Buy:** 1% of the $WIF spent. On a buy that sells out the curve, only the $WIF actually needed is pulled from
  the buyer, and the fee is charged on that amount.
- **Sell:** 1% of the gross $WIF taken from the curve.

`totalWifBurned()`, `wifBurnedOf(nationId)` and `totalWifLocked()` on the launchpad expose the burn and the $WIF
locked in graduated pools; the indexer mirrors them and an invariant test checks `wif.balanceOf(DEAD) ==
totalWifBurned()`.

AtlasPad charges no other fees:

- No token transfer tax.
- No fee on founder claims, governance or treasury donations.
- No AtlasPad fee on Uniswap V2 trades after graduation. The Uniswap V2 pool fee applies there; it is governed by
  the Uniswap deployment, not by AtlasPad.

The `Trade` event records the total fee of every curve trade. `NationTreasury.Deposited` (with
`fromTradeFees = true`) records the treasury share.

---

## 4. Founder allocation limits and vesting

- **Cap:** at most 5% of supply (`founderBps ≤ MAX_FOUNDER_BPS = 500`). It is taken out of the curve supply, not
  minted on top. It is published in `CurveInitialized.founderAllocation` and `getNation(id).founderAllocation`.
- **Vesting:** accrues linearly over 30 days (`FOUNDER_VESTING`) from the founding timestamp, whether or not the
  nation has graduated. Check with `vestedFounderTokens(id)` and `getNation(id).founderClaimed`.
- **Claimable only after graduation:** `claimFounderTokens` reverts with `NotGraduated` until the nation has
  graduated (`test_RevertWhen_FounderTokensClaimedBeforeGraduation`). After graduation, everything vested so far can
  be claimed at once, and the rest as it vests. Claims emit `FounderTokensClaimed`. Because the curve is closed by
  the time founder tokens can be claimed, they can never be sold back into the bonding curve against $WIF paid by
  other buyers. The app labels the allocation "30-day vesting, claimable after graduation".
- **Unvested and unclaimed tokens** stay in the launchpad, which is never delegated, so they carry no voting power.
- **Founding buy:** `initialBuyWif` becomes the founder's initial curve buy (in $WIF) in the same transaction.
  It pays the normal 1% fee and may not deliver more than 10% of supply (`MAX_INITIAL_BUY_BPS`). As the first buyer
  on a new curve, the founder gets the opening price.
- **What is not limited:**
  - The 10% cap applies only to the founding transaction. The founder, or anyone else, can buy more later from any
    address.
  - Claimed founder tokens are ordinary tokens. Once claimed, after graduation, they can be sold on the Uniswap V2
    pool (or anywhere else) like any other holder's tokens.
  - The founder role cannot be transferred. If the founder loses access to that address, unclaimed tokens stay in
    the launchpad permanently.

---

## 5. Treasury controls

- **Governance only.** `NationTreasury.release` is callable only by the immutable `AtlasGovernor`. The governor
  calls it only from `execute()` of a passed Treasury proposal for that nation. The deployer, the fee recipient and
  the founder cannot withdraw (`test_RevertWhen_ReleaseNotGovernor`).
- **Proposal requirements:** proposer holds ≥ 0.1% of supply at the snapshot; 3-day vote; quorum of 4% of supply
  (for plus abstain); `for > against`; 1-day timelock after voting ends; must be executed within 7 days of the ETA,
  after which it expires.
- **Rolling weekly cap:** within any 7-day window a nation can release at most 25% of the balance it held when the
  window opened (`MAX_RELEASE_BPS = 2_500`, `RELEASE_WINDOW = 7 days`), **however many proposals pass**. If an
  execution would exceed the remaining allowance it reverts and can be retried within the proposal's execution
  window.
- **Recipients:** the zero address and the treasury itself are rejected, both at proposal time and at release.
- **Separation:** each nation has its own balance, and a release can only draw on that nation's balance
  (`test_NationsAreIsolated`). Plain ETH sent to the treasury reverts. $WIF sent directly (without `deposit`) is not
  credited to any nation.
- **Parallel proposals cannot drain a treasury.** Earlier versions capped each proposal at 25% of the remaining
  balance, so several proposals passed together could empty a treasury in days. The cap is now cumulative per
  window: at most 25% per week, so at least 75% of a treasury survives any week of hostile governance
  (`test_ParallelTreasuryProposalsCannotDrainPastWeeklyCap`, `testFuzz_NeverDrainsFasterThanQuarterPerWeek`). Once
  $WIF is released, it is under the recipient's control.

---

## 6. Governance protections

| Protection | Implementation |
|---|---|
| No flash-loan or same-second voting | Voting weight is `getPastVotes(voter, snapshot)` with `snapshot = proposal timestamp − 1`. Tokens acquired in the proposal's second or later have no weight (`test_TokensBoughtAfterSnapshotCannotVote`, `test_FlashBuyCannotPassProposal`, `test_RevertWhen_TokensAcquiredThisSecondCannotPropose`). |
| No double counting | One vote per address per proposal (`hasVoted`). Tokens moved after the snapshot carry no new weight (`test_TransferredTokensCannotVoteTwice`). |
| Proposal threshold | 0.1% of total supply at the snapshot (`PROPOSAL_THRESHOLD_BPS = 10`) |
| Quorum | 4% for Treasury proposals and 1% for GameAction and Symbol proposals, as a fraction of total supply at the snapshot. Fixed when the proposal is created. Only `for + abstain` counts toward quorum. |
| Majority | `forVotes > againstVotes`. A tie is a defeat. |
| Timelock | 1 day for Treasury proposals. None for GameAction and Symbol proposals. |
| Expiry | Passed proposals expire 7 days after their ETA (`EXECUTION_WINDOW`). |
| Input validation | Payloads are validated at `propose` (see CONTRACTS.md §10). Descriptions ≤ 2,000 bytes, reasons ≤ 280 bytes, symbol URI ≤ 200 bytes. |
| Execution | Permissionless once `Executable`. `executed` is set before any external call. |
| Voting power | ERC20Votes with a timestamp clock. Holders are automatically self-delegated on first receipt. The launchpad, the Uniswap pair and `DEAD` never receive voting power. |

What governance does **not** protect against:

- **Capture by large holders.** A holder or coordinated group with enough tokens can pass proposals if others do not
  vote against them. That includes treasury releases to an address of their choice (up to 25% of the
  treasury per week).
- **There is no veto, guardian or emergency cancel.** Only the proposer can cancel, and only while voting is open.
  The 1-day treasury timelock gives holders time to react, for example by exiting. It is not a mechanism to block
  a passed proposal.
- **Quorum counts non-voting supply.** Quorum is measured against total supply, which includes tokens that cannot
  vote (unsold curve tokens, the LP reserve, unclaimed founder tokens, tokens in the pair or at `DEAD`). Early in a
  nation's life a large share of the circulating supply may be needed to reach quorum.
- **Proposal spam.** Anyone above the 0.1% threshold can create any number of proposals.
- **Game outcomes are off-chain.** GameAction proposals only emit `GameActionExecuted`. The game effects are
  computed off-chain ([§11](#11-off-chain-components)).

---

## 7. Re-entrancy and external calls

- **AtlasLaunchpad:** `foundNation`, `buy`, `sell`, `sellWithPermit`, `claimFounderTokens` and
  `withdrawProtocolFees` are `nonReentrant` (OpenZeppelin `ReentrancyGuard`). In buys and sells, curve state and
  fee accounting are updated before token transfers, and the $WIF paid to a seller is sent last. Graduating buys
  pull only the $WIF they need, so there is no refund call. `withdrawProtocolFees` zeroes `protocolFeesAccrued`
  before sending. A test deploys AtlasPad on an ERC-777-style $WIF stand-in that calls back into every recipient and
  confirms that re-entering `buy`, `sell` and `withdrawProtocolFees` fails (`test_ReentrancyOnSellBlocked`).
  Incoming $WIF is balance-checked, so fee-on-transfer or rebasing tokens revert with `UnsupportedToken`
  (`test_RevertWhen_FeeOnTransferWif`).
- **NationTreasury:** `release` is `nonReentrant` and updates balances (and emits `Released`) before sending $WIF.
- **AtlasGovernor:** has no re-entrancy guard. `execute` sets `executed = true` before calling the treasury or the
  launchpad. `propose` and `castVote` make only `view` calls (to `launchpad.tokenOf` and the token's
  `getPastVotes` and `getPastTotalSupply`). Its only external calls go to the immutable launchpad, treasury and
  nation tokens. If a treasury recipient tries to re-enter through another `execute`, the nested
  `NationTreasury.release` hits the treasury's re-entrancy guard and reverts.
- **Contracts called during graduation:** the $WIF token and the nation/WIF Uniswap V2 pair. Their addresses come
  from the immutable factory and $WIF configured at deployment.
- **$WIF transfers** use OpenZeppelin `SafeERC20`. AtlasPad assumes $WIF is a standard ERC-20 (no transfer hooks
  that block the launchpad, treasury, pair or `0x…dEaD`).

---

## 8. Slippage and deadline protection

| Entry point | Slippage bound | Deadline |
|---|---|---|
| `buy(nationId, minTokensOut, deadline)` | `minTokensOut` (`Slippage`) | `deadline` (`Expired` if `block.timestamp > deadline`) |
| `sell(nationId, tokensIn, minEthOut, deadline)` | `minEthOut` | `deadline` |
| `sellWithPermit(..., minEthOut, deadline, v, r, s)` | `minEthOut` | `deadline`, also used as the permit deadline |
| `foundNation(p)` initial buy | `p.minTokensOut` | None |

- **`foundNation` has no deadline.** Its initial buy is the first trade on a brand-new curve in the same
  transaction, so its output is fixed by the inputs. The practical front-running risk is someone else taking the
  name or symbol first, in which case the transaction reverts (`NameTaken` or `SymbolTaken`).
- **Quotes match execution.** `quoteBuy` and `quoteSell` use the same internal math as execution
  (`testFuzz_QuoteBuyMatchesExecution`).
- **`sellWithPermit` tolerates a used permit.** If the permit was already used (for example by a front-runner
  submitting it), the sell still succeeds as long as the allowance covers it.

Web app defaults (`apps/web/src/components/nation/TradePanel.tsx`, `apps/web/src/app/found/page.tsx`):

- Slippage tolerance is 1% for curve trades and 2% for Uniswap trades. Users can choose 0.5%, 1%, 2% or 5%.
- Transaction deadline is now + 20 minutes.
- The founding initial buy uses `minTokensOut` = 98% of the locally previewed amount.

After graduation, Uniswap trades go through the Uniswap V2 Router02 with its own `amountOutMin` and `deadline`
parameters.

---

## 9. Pre-graduation pair-transfer lock

**Rule.** `NationToken._update` reverts with `PoolLockedUntilGraduation` for any transfer **to** the nation's
token/WIF Uniswap V2 pair while `graduated == false`. Only the launchpad can set `graduated`, by calling
`markGraduated()` immediately before it seeds the pool, and it cannot be unset.

**Why.** Without the lock, anyone holding curve-bought tokens could deposit tokens and $WIF into the empty pair
before graduation and mint LP at a ratio of their choosing. The launchpad's graduation deposit would then enter a
pool at a manipulated price, which could be arbitraged at the expense of the migrated liquidity. With the lock, the
pool can hold no nation tokens until the launchpad itself deposits the 20% LP reserve together with the raised $WIF.

**Edge cases handled.**

- *The pair is created before the token exists.* The pair address is predictable from the CREATE2 token address.
  The token constructor reuses an existing pair, and nobody can deposit tokens into it
  (`test_FoundingSurvivesPreCreatedPair`).
- *$WIF is donated to the pair, optionally followed by `sync()`.* This cannot be prevented. It only raises the
  opening price, and the donated $WIF is locked with the burned LP (`test_DonatedWifBeforeGraduationOnlyRaisesPrice`).

**Limits of the lock.** It covers only this one token/WIF pair from the configured factory. Anyone can create other
pools for a nation token, on other DEXes or with other quote assets, at any time. Those pools are outside AtlasPad.

---

## 10. Known limitations and risks

1. **Not audited.** See [§1](#1-audit-status-and-scope).
2. **Market risk.** Token prices are set by the bonding curve and, after graduation, by the Uniswap V2 pool. Prices
   can fall sharply, and tokens may become impossible to sell at a meaningful price.
3. **Thin liquidity after graduation.** The pool is seeded with `graduationWif` of $WIF and 20% of supply, and the
   LP tokens are burned. Large trades will move the price significantly. Nobody can add AtlasPad-owned liquidity
   later.
4. **Graduation may never happen.** A nation graduates only when a buy sells out its curve, and there is no time
   limit or refund mechanism. Until then, the curve is the only AtlasPad venue, and its buy-back is limited as
   described below.
5. **Curve buy-back limits.** The curve buys back at most the amount it has sold, net
   (`curveTokensRemaining + tokensIn ≤ curveSupply`), and never more $WIF than the nation's `realWif`; otherwise a
   sell reverts with `InsufficientCurveLiquidity`. Founder tokens cannot use up this capacity: they can be claimed
   only after graduation, when the curve is closed. Before graduation every token outside the launchpad was bought
   from the curve, and selling all of them back restores the curve (`test_SellingBackEverythingRestoresTheCurve`).
6. **Governance risks.** See [§6](#6-governance-protections): capture by large holders, no veto, quorum measured
   against total supply, proposal spam.
7. **Timestamps, not block numbers.** On Arbitrum Orbit chains such as Robinhood Chain, the EVM `block.number` tracks
   the parent chain (as noted in `NationToken.sol`). AtlasPad therefore uses `block.timestamp` for the votes clock
   (ERC-6372 `mode=timestamp`), snapshots, voting periods, timelocks, vesting and trade deadlines. Timestamps are set
   by the chain's sequencer and may differ from wall-clock time. Several L2 blocks can share a timestamp. Because
   the snapshot is taken at `timestamp − 1`, tokens acquired in any block of the proposal's second carry no weight.
8. **External infrastructure.** Graduation depends on the configured Uniswap V2 factory and pair and on the $WIF
   token. The deploy script checks that these addresses have code and are consistent (`router.factory()`), and logs
   $WIF's symbol, decimals and supply, but it cannot prove that they are the canonical deployments. Every nation's
   value is quoted in $WIF, so a failure or depeg of $WIF itself affects every nation. The addresses come from the configuration in
   `packages/shared/src/chains.ts`.
9. **The fee recipient is immutable.** `withdrawProtocolFees` pays $WIF to it. If $WIF ever blocked transfers to
   that address, protocol fees would stay in the launchpad permanently. User funds and treasuries are unaffected.
10. **Names and symbols are first come, first served.** They are permanent and unmoderated on-chain. A nation's name
    or symbol does not imply any affiliation or endorsement.
11. **User-supplied strings.** Nation descriptions, metadata URIs, proposal descriptions, vote reasons and alliance
    names are arbitrary on-chain data, checked only for length and, for names and symbols, character set. Treat
    them as untrusted when displaying them.
12. **No recovery paths.** Because nothing can be upgraded or administered, funds or tokens stuck through user error
    (for example tokens sent to the token contract or another unrelated address) cannot be recovered by anyone.

---

## 11. Off-chain components

The contracts are the only source of truth for balances, trades, proposals and treasury funds. The off-chain
components index and present that data. They hold no keys that control funds.

### Indexer (`apps/indexer`)

- **Read-only toward the chain.** It reads blocks and logs over RPC and never signs or sends transactions. It waits
  `INDEXER_CONFIRMATIONS` blocks (default 2) and has reorg handling.
- **Not authoritative.** Its database can lag, be wrong, or be rebuilt. Always check critical values against the
  contracts. The web app's proposal state mirrors `AtlasGovernor.state()` against the indexed chain clock (the
  latest indexed block's timestamp), and the source notes that the contract remains authoritative for execution.
- **Game state is off-chain.** The game engine (`apps/indexer/src/game/`) derives buildings, wars and alliances from
  `GameActionExecuted` and other events. That state exists only in the indexer's database and can be replayed
  deterministically from the on-chain mirror (`pnpm --filter @atlaspad/indexer rebuild-game`). The rules are in
  [GAME_MECHANICS.md](GAME_MECHANICS.md).
- **Public HTTP endpoints** (`apps/indexer/src/realtime/server.ts`): `GET /health` and `GET /stream` (Server-Sent
  Events, capped at 5,000 clients). Methods other than GET and OPTIONS (CORS preflight) return 405. CORS origin is
  `INDEXER_CORS_ORIGIN`, default `*`.
- **Admin endpoint.** `GET /admin/status` requires `Authorization: Bearer <INDEXER_ADMIN_TOKEN>`.
  - The token is compared with `crypto.timingSafeEqual` after a length check.
  - If `INDEXER_ADMIN_TOKEN` is not set, the endpoint returns 404.
  - It is read-only (RPC, database and indexer health, counts, recent errors and blocks). It shows the RPC URL as
    only `protocol//host`, followed by `/***` when the URL has a path, a query or credentials, so API keys in any of
    those parts are not returned. There are no admin controls.
- **Optional price feed.** With `WIF_USD_SOURCE=dexscreener`, the indexer fetches the $WIF/USD price of the most
  liquid $WIF pool from the Dexscreener public API. It is used to display USD equivalents, is stored in the hourly snapshots, and feeds the
  `MCAP_1M_USD` ("Millionaire Economy") achievement. It never affects on-chain values.

### Web app (`apps/web`)

- **Admin dashboard.** `/admin`, `/admin/*` and `/api/admin/*` are protected by HTTP Basic auth in
  `apps/web/src/proxy.ts`, using `apps/web/src/lib/admin-auth.ts`.
  - The dashboard is disabled (404) unless `ADMIN_USERNAME` and `ADMIN_PASSWORD` are both set and the password is at
    least 12 characters long. A shorter password logs a warning once and keeps the dashboard disabled.
  - Credentials are compared in a loop that does not exit early.
  - Responses carry `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
  - `/api/admin/status` checks authorization again, is read-only, and calls the indexer's admin endpoint with the
    server-side `INDEXER_ADMIN_TOKEN`. That token is not a `NEXT_PUBLIC_*` variable, so it is not shipped to
    browsers.
  - No rate limiting or lockout is implemented, and Basic auth sends credentials with every request. Serve the
    dashboard over HTTPS only and use a long random password.
- **No private keys.** The web app does not hold or use private keys. Users sign every transaction and permit in
  their own wallet through wagmi (`writeContract` and `signTypedData` in `apps/web/src/lib/tx.ts`).
  - Connectors: injected wallets (EIP-6963 discovery), WalletConnect (only when
    `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set) and Coinbase Wallet.
  - Browser configuration is limited to public `NEXT_PUBLIC_*` values: network, RPC URL, contract addresses and
    site URL.
- **Wallet SDK telemetry.** The Coinbase Wallet connector in `apps/web/src/lib/wagmi.ts` is configured with
  `preference: { options: "all", telemetry: false }`.
- **Rendering on-chain text.** No `dangerouslySetInnerHTML` usage was found in `apps/web/src` when this was
  written. Keep it that way for on-chain strings.

### Secrets hygiene

- `.gitignore` excludes `.env` and `.env.*` (except `.env.example`).
- Deploy with a Foundry keystore account (`--account deployer`), as the `Deploy.s.sol` header recommends, rather
  than a raw private key.
- The private key in `DeployLocal.s.sol`'s comment is anvil's public development key. `DeployLocal` refuses to run
  on any chain other than 31337. Never use that key on a live network.

---

## 12. Pre-deployment checklist

The scripts automate some of these checks. The rest are manual. The full operator procedure is in
[DEPLOYMENT.md](DEPLOYMENT.md).

1. **Tests pass.** Run `cd contracts && forge build && forge test`, and preferably also
   `FOUNDRY_PROFILE=ci forge test` for more fuzz runs. All tests must pass. `Deploy.s.sol` does **not** run the tests
   itself, and the repository has no CI configuration.
2. **Choose the immutable parameters carefully.** They cannot be changed later.
   - `PROTOCOL_FEE_RECIPIENT`: a multisig is recommended. It receives $WIF.
   - `GRADUATION_WIF`: `1e6`–`1e36` $WIF base units (recommended 200,000 WIF).
   - `CREATION_FEE_WIF`: ≤ `GRADUATION_WIF` (recommended 100 WIF, burned on every founding).
3. **Set the environment.**
   - `EXPECTED_CHAIN_ID=4663`
   - `UNISWAP_V2_FACTORY`, `UNISWAP_V2_ROUTER`, `WIF_ADDRESS`: values in CONTRACTS.md §2
   - `ROBINHOOD_RPC_URL`
   - `BLOCKSCOUT_API_KEY` for source verification
4. **Run `Deploy.s.sol`** with a keystore account. The script itself:
   - **pre-flight:** reverts with `unexpected chain id` unless `block.chainid == EXPECTED_CHAIN_ID`; checks that the
     factory, router and $WIF have code; checks `router.factory()`; checks that `getPair` can be called; logs $WIF's
     symbol, decimals and supply; checks the parameter bounds.
   - **address prediction:** requires each deployed address to match its CREATE prediction.
   - **post-flight:** checks every cross-reference and parameter, and that `nationCount() == 0`.
   - **record:** writes `contracts/deployments/4663.json` only when broadcasting. A dry run (no `--broadcast`) writes
     its predicted addresses to the gitignored `contracts/deployments/4663.dry-run.json` and logs `DRY RUN`.
5. **Verify on-chain.** Run `forge script script/VerifyDeployment.s.sol --rpc-url robinhood`. It re-checks code
   presence, wiring, the DEX configuration, and treasury and launchpad solvency against the live chain. Confirm the
   source verification on https://robinhoodchain.blockscout.com.
6. **Smoke test with small amounts.** Run `SmokeTest.s.sol` with `SMOKE_CONFIRM=I_UNDERSTAND`.
   - It founds a real, permanent nation (default name `Atlas Smoke Test`, symbol `SMOKE`), spending the creation fee
     (burned) plus 100 WIF by default (`SMOKE_INITIAL_BUY_WIF`), buys again for 200 WIF by default (`SMOKE_BUY_WIF`),
     and sells half back.
   - It uses `minOut = 0`, which is acceptable only because the amounts are tiny.
   - It then asserts balances and auto-delegated votes.
7. **Configure off-chain components** with the recorded addresses and deployment block (the `ATLAS_*` and
   `NEXT_PUBLIC_ATLAS_*` variables), confirming the deployment block on the explorer. Set `INDEXER_ADMIN_TOKEN`
   and the admin credentials only on servers.

---

## 13. Reporting a vulnerability

Report suspected vulnerabilities **privately**:

1. On this repository's GitHub page, open **Security → Advisories → Report a vulnerability**. This creates a
   private GitHub security advisory that only the maintainers can see.
2. Include:
   - the affected contract or component, with file and line references
   - a description of the issue and its impact
   - a proof of concept (a Foundry test against `contracts/test/Base.t.sol` is ideal)
   - any suggested fix
3. Do not disclose the issue publicly, open a public issue, or exploit it on a live network while it is being
   handled.

If private vulnerability reporting is not available on the repository, open a public issue that **only** asks the
maintainers to enable it or to contact you, and include no vulnerability details.

There is no security email address and no bug bounty program. Because the contracts are immutable, a confirmed
issue in deployed contracts cannot be patched in place. Remediation would mean warning users and, where
appropriate, deploying new contracts.
