# AtlasPad × $WIF: hackathon submission

**One line:** AtlasPad turns $WIF into the currency of an on-chain civilization game on Robinhood Chain. Every nation
is founded, bought, sold, taxed and pooled in $WIF, and playing the game burns and locks $WIF.

**Categories:** Games · Hooks and DeFi · Social and creators · Onboarding

---

## 1. A real reason to use $WIF

On AtlasPad, every token is a nation and every holder is a citizen. Citizens vote on-chain to build, ally, declare
war and spend their national treasury, and a deterministic engine turns all of that into a living world map.

There is one currency for all of it: **$WIF**.

| You want to… | You need $WIF because… |
| --- | --- |
| Found a nation | The founding fee is paid in $WIF and **burned** |
| Become a citizen of any nation | Nation tokens are bought on their bonding curve **with $WIF** |
| Leave a nation | You sell back to the curve **for $WIF** |
| Trade a graduated nation | Its only AtlasPad pool is **nation/WIF** on Uniswap V2 |
| Fund your nation | Treasuries hold **$WIF**; anyone can donate $WIF to a nation |
| Win wars and climb leaderboards | Scores are driven by citizen growth and **$WIF volume** |

This is not a $WIF "integration" bolted onto an ETH app. The contracts have no ETH path at all: `AtlasLaunchpad`,
`NationTreasury` and every nation's Uniswap pool hold and move only $WIF (ETH is used only for gas).

## 2. The flywheel

```
        ┌──────────── 1. Join with $WIF ────────────┐
        │  every nation is bought/sold in $WIF      │
        ▼                                           │
 2. Every trade burns $WIF                          │
    1% fee: 0.5% treasury · 0.25% BURNED · 0.25%    │
    founding fee: 100% BURNED                       │
        │                                           │
        ▼                                           │
 3. Treasuries fill with $WIF                       │
    citizens vote to spend it on recruiting,        │
    bounties and prizes (max 25%/week)              │
        │                                           │
        ▼                                           │
 4. Wars reward growth                              │
    war score = citizen growth + $WIF volume + …    │
    → nations recruit → new citizens bring $WIF ────┘
        │
        ▼
 5. Graduation LOCKS $WIF
    sold-out curve → nation/WIF Uniswap V2 pool, LP burned forever
    graduated nations still trade against $WIF, so step 1 never ends
```

Why it keeps bringing people back:

- **Status is competitive and continuous.** Hourly epochs, leaderboards, wars every 48 hours, golden ages and crises
  give citizens a reason to return, and every way to move up (citizens, volume, liquidity) routes through $WIF.
- **Treasuries are a $WIF budget with a voice.** Citizens propose and vote on how their nation spends $WIF, which
  turns holders into recruiters.
- **Supply only goes one way.** Every trade and every founding burns $WIF, and every graduation locks $WIF in a pool
  whose LP is burned. None of it can come back out.

## 3. Verify it on-chain

Everything above is enforced by the contracts and observable as events and view functions.

| Claim | Where to check |
| --- | --- |
| $WIF is the curve currency | `AtlasLaunchpad.wif()`, `buy(nationId, wifIn, minTokensOut, deadline)`, `sell(...)` returning $WIF |
| Founding fee burned | `WifBurned(nationId, amount, creationFee = true)`; $WIF transfer to `0x…dEaD` in the founding tx |
| 0.25% of every trade burned | `WifBurned(nationId, amount, false)` in every curve trade tx |
| Totals | `totalWifBurned()`, `wifBurnedOf(nationId)`, `totalWifLocked()` on the launchpad |
| Treasuries hold $WIF | `NationTreasury.wif()`, `balanceOf(nationId)`, `Deposited` / `Released` events |
| Graduation locks $WIF | `NationGraduated(nationId, pair, wifLiquidity, tokenLiquidity, lpBurned)`; pair LP held by `0x…dEaD` |
| No admin keys | No owner, pause or upgrade path in any contract (see [SECURITY.md](SECURITY.md)) |

The app shows the same numbers live: the landing page's **$WIF flywheel** panel (burned, locked in pools, in
treasuries, traded), a **$WIF burned** stat on every nation, and the exact burn of each trade in the trade
review dialog.

## 4. What is built and tested

| Layer | What changed for $WIF | Tests |
| --- | --- | --- |
| Contracts | $WIF bonding curve; nation/WIF graduation; fee burn; burned creation fee; $WIF treasuries with a rolling 25%/week release cap; fee-on-transfer protection; `wifToGraduate` view | **114 Foundry tests pass**, including stateful invariants (`wif.balanceOf(DEAD) == totalWifBurned`, solvency, custody) and fuzz tests |
| Indexer | All values in $WIF; `WifBurned` indexed per nation; flywheel totals; nation/WIF pool tracking; optional WIF/USD price | **8 integration tests** on a real local chain + Postgres, including "indexed burns equal on-chain totals" |
| Game engine | All market rules calibrated in "market units" (`WIF_MARKET_UNIT`), so balance holds whatever $WIF trades at | 30 unit tests |
| Web app | $WIF approvals for founding and buying, gasless permit sells, nation ↔ WIF swaps after graduation, live flywheel panel, Get $WIF links | Browser E2E: approve → found → approve → buy → permit-sell → govern → map → flywheel, **no page errors** |

Run everything yourself: [README.md](README.md#commands).

## 5. Go-live checklist (do this before submissions close: 2 Nov 2026, 17:30 UTC)

The rules require a live project and real transactions. The sandbox that built this could not reach Robinhood
Chain, so **the team lead must deploy**. Full procedure: [DEPLOYMENT.md](DEPLOYMENT.md).

1. **Confirm $WIF.** `WIF_ADDRESS` is `0x5173b8eA6923c2d40267890D45C46a3480954773`
   (`packages/shared/src/chains.ts` and `.env.example`). The deploy preflight logs its symbol, decimals and supply.
   If decimals are not 18, update `WIF_DECIMALS` in `chains.ts` before building the apps.
2. **Pick the market unit.** `WIF_MARKET_UNIT` (`packages/shared/src/game/constants.ts`) is 100,000 WIF. Set it so
   that 2 units (the graduation target) is a sensible amount to raise per nation at today's $WIF price.
3. **Deploy** (`contracts/`, keystore account funded with ETH for gas):
   ```bash
   export EXPECTED_CHAIN_ID=4663 WIF_ADDRESS=0x5173b8eA6923c2d40267890D45C46a3480954773 \
     UNISWAP_V2_FACTORY=0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f \
     UNISWAP_V2_ROUTER=0x89e5db8b5aa49aa85ac63f691524311aeb649eba \
     PROTOCOL_FEE_RECIPIENT=<your multisig> \
     GRADUATION_WIF=200000000000000000000000 CREATION_FEE_WIF=100000000000000000000
   forge script script/Deploy.s.sol --rpc-url robinhood --account deployer          # dry run first
   forge script script/Deploy.s.sol --rpc-url robinhood --account deployer --broadcast --verify \
     --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
   forge script script/VerifyDeployment.s.sol --rpc-url robinhood
   ```
4. **Create the proof transactions** (all real $WIF): run `SmokeTest.s.sol` (found + buy + sell), then from the web
   app found a nation, buy, sell, propose and vote. Keep the explorer links for the submission.
5. **Host** the indexer + Postgres and the web app with the deployed addresses (DEPLOYMENT.md §6–§8). Set
   `WIF_USD_SOURCE=dexscreener` for USD values. Keep everything running until **6 Nov 2026, 17:30 UTC**.
6. **Submit** the public repo, the demo video and the transaction links below.

### Proof transactions (fill in after deploying)

| Action | Explorer link |
| --- | --- |
| AtlasLaunchpad deployment | |
| Nation founded ($WIF fee burned) | |
| Curve buy with $WIF (`WifBurned`) | |
| Curve sell for $WIF | |
| Governance proposal / vote | |
| Graduation into a nation/WIF pool (if reached) | |

## 6. Demo video script (about 2½ minutes)

1. **Hook (15 s).** Landing globe: "Every token is a nation, and every nation runs on $WIF." Scroll to the live
   $WIF flywheel panel: burned, locked, in treasuries.
2. **Found a nation (40 s).** Wizard: name, ticker, flag, supply. On the launch step, point at "Founding fee
   (burned)". Approve $WIF, found, and watch the founding cinematic.
3. **Become a citizen (30 s).** Buy with $WIF; the review shows "$WIF burned by this trade". Open the transaction
   on Blockscout and show the `WifBurned` event and the transfer to `0x…dEaD`.
4. **Govern (30 s).** Propose a Capitol, vote, and show the treasury tab: "real $WIF, at most 25% per week".
5. **The world (20 s).** The nation on the map, a war's score breakdown ($WIF volume is a war metric), the
   leaderboard.
6. **Close (15 s).** The flywheel panel again: "Play, and $WIF gets used, burned and locked."

## 7. Honest limitations

- Not externally audited. No admin keys means bugs cannot be patched in place; a fix means a new deployment.
- Thinly traded nation tokens can go to zero. AtlasPad never promises returns.
- Game outcomes (wars, buildings) are computed off-chain by the indexer from on-chain data with published,
  deterministic rules that anyone can replay; the money and the votes are fully on-chain.
- AtlasPad is not affiliated with Robinhood Markets, Inc.
