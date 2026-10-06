# AtlasPad: Game Mechanics

> Every token is a nation. Every holder is a citizen.

This document describes the AtlasPad game rules **as they are implemented**. Every number below is copied from the code. Where this document and the code ever disagree, the code is authoritative. The main sources are:

| Area | Source |
| --- | --- |
| Rule constants, formulas and validators | `packages/shared/src/game/*.ts` |
| World map, capitals and territory | `packages/shared/src/world/index.ts` |
| Deterministic game engine (replays chain data) | `apps/indexer/src/game/*.ts` |
| Chain mirror, citizenship, live metrics, news, XP | `apps/indexer/src/sync/*.ts`, `apps/indexer/src/context.ts` |
| On-chain governance, treasury, launchpad, token | `contracts/src/*.sol` |
| Leaderboards and citizen XP queries | `apps/web/src/app/leaderboard/page.tsx`, `apps/web/src/lib/server/queries.ts` |

---

## Contents

1. [Principles](#1-principles)
2. [Nations](#2-nations)
3. [Citizens](#3-citizens)
4. [National statistics](#4-national-statistics)
5. [Territory and the world map](#5-territory-and-the-world-map)
6. [Ranks and leaderboards](#6-ranks-and-leaderboards)
7. [Game time: the engine and hourly epochs](#7-game-time-the-engine-and-hourly-epochs)
8. [Resources](#8-resources)
9. [Buildings](#9-buildings)
10. [Governance: proposing, voting, enacting](#10-governance-proposing-voting-enacting)
11. [Wars](#11-wars)
12. [Alliances](#12-alliances)
13. [World events](#13-world-events)
14. [Atlas News](#14-atlas-news)
15. [Player progression](#15-player-progression)
16. [The national treasury](#16-the-national-treasury)
17. [On-chain vs off-chain state, replay and rebuild](#17-on-chain-vs-off-chain-state-replay-and-rebuild)
18. [Fairness notes](#18-fairness-notes)
19. [Appendix A: the founding curve](#appendix-a-the-founding-curve)

---

## 1. Principles

- **The blockchain is the source of truth.** AtlasPad runs on Robinhood Chain (chain id 4663), an Arbitrum Orbit L2 that uses ETH for gas. The contracts hold nations, tokens, votes and treasury ETH.
- **Game state is derived, not stored on-chain.** The indexer mirrors contract events into a database. A deterministic game engine then replays those events in time order to produce resources, buildings, wars, alliances, events, news and achievements. That state can be wiped and rebuilt from chain data at any time (see [section 17](#17-on-chain-vs-off-chain-state-replay-and-rebuild)).
- **Nothing is random.** The engine has no random number generator. Every outcome is a function of indexed on-chain data: trades, transfers, liquidity, votes and executed decrees. The world map is generated procedurally from a fixed seed, and capitals are placed from a hash of each token address.
- **There is no gambling.** Wars are decided by a published formula over measurable metrics, and ties go to the defender. No tokens or ETH are at stake in any game action. `AtlasGovernor` has no payable function, and no contract accepts bets or stakes on outcomes.
- **Game values are not assets.** Resources, scores, influence and XP live only in the indexer database. They cannot be bought, sold, transferred or withdrawn (`packages/shared/src/game/constants.ts`, `resources.ts`).

---

## 2. Nations

**A nation is a token.** Calling `AtlasLaunchpad.foundNation` deploys a new `NationToken` (an ERC-20 with ERC20Votes and a timestamp clock). It assigns the next sequential nation id (starting at 1) and records `tokenOf(nationId)`. The caller becomes the nation's **founder**.

| Founding rule | Value (from `AtlasLaunchpad.sol`) |
| --- | --- |
| Name | 2–32 characters from `A–Z a–z 0–9`, space, `.`, `-`, `'`. No leading, trailing or double spaces. Unique (case-insensitive). |
| Symbol (ticker) | 2–10 characters from `A–Z 0–9`. Unique. |
| Description / metadata URI | ≤ 280 bytes / ≤ 200 bytes |
| Total supply | 1,000,000 to 1,000,000,000,000 whole tokens. Fixed and minted once to the launchpad. No mint, owner, pause, blacklist, transfer tax or upgrade path. |
| Founder allocation | 0–5% of supply, vesting linearly over 30 days from founding and claimable only after graduation (the UI shows "30-day vesting, claimable after graduation"). Held by the launchpad until claimed, so founder tokens can never be sold back into the bonding curve. |
| Founder's initial buy | Any ETH sent above the creation fee is used to buy on the curve. It may not exceed 10% of supply. |
| Creation fee | Immutable per deployment (may be zero). Paid to the protocol, not to the treasury. |
| Theme | One of 8: Medieval, Cyberpunk, Space, Ocean, Jungle, Meme, AI, Fantasy. **Cosmetic only.** No game formula reads it. |
| Emblem (flag) | A single `uint256`: glyph (24 options), pattern (8), and primary, secondary and accent colours. Out-of-range ids wrap around. Can only be changed by a Symbol proposal ([section 10](#10-governance-proposing-voting-enacting)). |

**Graduation ("joining world markets").** Tokens first trade on a bonding curve ([Appendix A](#appendix-a-the-founding-curve)). When the curve allocation sells out, the launchpad seeds a Uniswap V2 pool with the raised ETH and the 20% LP reserve. The LP tokens are minted to `0x…dEaD`, which locks the liquidity permanently. Graduation affects the game in three ways:

- It is required to build the **Port** and the **Spaceport**.
- It is required for the **National Emergency** event.
- It unlocks the **World Markets** achievement.

Graduation also makes the founder's vested allocation claimable (`claimFounderTokens` reverts with `NotGraduated` before it).

**Market metrics used by the game** (`apps/indexer/src/sync/nations.ts`, `apply.ts`):

| Metric | Definition |
| --- | --- |
| Price (ETH/token) | Before graduation: `virtualEth / virtualTokens`. After: Uniswap pool WETH reserve ÷ token reserve. |
| Market cap (ETH) | Price × **total** supply |
| Liquidity (ETH) | Before graduation: ETH actually held by the curve (`realEth`). After: the pool's WETH reserve. |
| Volume (ETH) | Sum of trade ETH amounts. Curve buys count ETH paid including the fee; curve sells count ETH received after the fee. Uniswap swaps count WETH in (buys) or WETH out (sells). |

---

## 3. Citizens

A **citizen** is an address whose balance of the nation's token is **at or above 0.0001% of total supply**:

```ts
citizenThreshold = totalSupply / 1_000_000n   // integer division on base units (18 decimals)
isCitizen       = balance >= citizenThreshold && address not excluded
```

For example, a 1,000,000,000-token nation has a threshold of 1,000 tokens.

**Addresses that are never citizens** (`apps/indexer/src/context.ts`, `packages/shared/src/chains.ts`):

| Excluded address | Why |
| --- | --- |
| `0x0000000000000000000000000000000000000000` and `0x000000000000000000000000000000000000dEaD` | Zero and burn addresses |
| Uniswap V2 Router, Uniswap V2 Factory, WETH | DEX and protocol infrastructure |
| On Robinhood Chain: Uniswap Universal Router (3 deployments), SwapRouter02, Permit2, UniswapX V3 Dutch Order Reactor | Infrastructure that may hold tokens briefly |
| AtlasLaunchpad | The bonding curve. It holds unsold curve tokens, the LP reserve before graduation, and unclaimed founder allocation. |
| NationTreasury, AtlasGovernor | AtlasPad system contracts |
| Each nation's own Uniswap V2 pair | Locked pool liquidity |
| Any address in the `EXCLUDED_ADDRESSES` environment variable | Operator-configured exclusions |

**How citizens are counted.**

- **Live count.** After every indexed block range, the indexer counts rows in its `holders` balance mirror that are at or above the threshold and not excluded. This live count feeds the leaderboards and the nation header.
- **Historical count.** When the engine needs a count *as of a past time*, it recomputes balances from the full `Transfer` history up to that timestamp. The engine does this for hourly snapshots, building checks, war start and end, and the Space Pioneer achievement.
- **Counting is per address.** Beyond the minimum balance there is no identity check, so one person with several qualifying wallets counts as several citizens.
- **The founder counts like anyone else** once their own wallet holds at least the threshold. Unclaimed founder tokens sit in the excluded launchpad.

**Citizenship is not voting power.** Voting uses the ERC20Votes balance at a proposal's snapshot ([section 10](#10-governance-proposing-voting-enacting)), and any non-zero voting power may vote, even below the citizen threshold. Tokens self-delegate automatically the first time an address receives them, except for the launchpad, the pair and `0x…dEaD`.

---

## 4. National statistics

All scores run from 0 to 100, are clamped, and are rounded to one decimal (`packages/shared/src/game/stats.ts`). Most of them use a bounded logarithmic scale:

```ts
logScore(x, lo, hi) = x <= 0 ? 0 : clamp( log10(1 + x/lo) / log10(1 + hi/lo), 0, 1 )
// x = lo maps to about 0.05; x >= hi maps to 1
```

**Inputs:**

- Market data: market cap, liquidity, 24h volume (all in ETH), and citizens.
- Game state: the set of *completed* buildings, the nation's influence resource, its war wins, and its allies (active alliance members − 1).

Building flags below are 1 if the building is complete and 0 otherwise.

| Statistic | Formula |
| --- | --- |
| **Economic power** | `100 × (0.5·logScore(mcap, 0.01, 10 000) + 0.3·logScore(liquidity, 0.01, 5 000) + 0.2·logScore(vol24h, 0.001, 2 000)) × (1 + 0.10·Bank + 0.05·Port)` |
| **Population score** | `100 × logScore(citizens, 1, 100 000)` |
| **Military power** | `100 × (0.45·logScore(citizens, 1, 100 000) + 0.35·(economic/100) + 0.20·min(1, warWins/10)) × (1 + 0.10·Factory + 0.05·Capitol)` |
| **Defensive power** | `military × (1 + 0.10·Capitol + 0.10·Monument)` |
| **Influence score** | `100 × logScore(influence resource, 10, 1 000 000)` |
| **Development score** | `completed building types / 8 × 100` (12.5 per building) |
| **Civilization score** | `(0.35·economic + 0.25·population + 0.15·military + 0.15·influence + 0.10·development) × (Spaceport ? 1.1 : 1)` |

Civilization score uses the already-rounded component scores. Some reference points (computed with the shared code):

| Citizens | Population score | Influence (resource) | Influence score | Market cap (ETH) | `logScore(mcap, 0.01, 10 000)` |
| --- | --- | --- | --- | --- | --- |
| 1 | 6.0 | 10 | 6.0 | 0.01 | 0.050 |
| 10 | 20.8 | 100 | 20.8 | 1 | 0.334 |
| 100 | 40.1 | 1,000 | 40.1 | 10 | 0.500 |
| 1,000 | 60.0 | 10,000 | 60.0 | 100 | 0.667 |
| 10,000 | 80.0 | 100,000 | 80.0 | 1,000 | 0.833 |
| 100,000 | 100 | 1,000,000 | 100 | 10,000 | 1.000 |

**Tiers.** A nation's tier is the highest tier whose minimum its civilization score reaches (`TIERS` in `constants.ts`):

| Tier | Name | Minimum civilization score |
| --- | --- | --- |
| 0 | Settlement | 0 |
| 1 | Town | 15 |
| 2 | City | 35 |
| 3 | Metropolis | 55 |
| 4 | Empire | 75 |

**When statistics are computed:**

1. **Live**, for every nation touched by a block range or an engine step (`refreshNationMetrics`). "Now" is the timestamp of the latest indexed block, never wall-clock time, and 24h volume is trades in `(now − 24h, now]`.
2. **At every hourly epoch**, from that epoch's snapshot. These values drive resource production, market events, and the Empire and Emperor achievements.
3. **At the end of a war**, for both sides, as of the war's end time.

---

## 5. Territory and the world map

**Territory size.** Each nation claims a number of hex cells that grows faster than linearly with civilization score (`territoryCells` in `stats.ts`):

```ts
territoryCells = round( (6 + floor( clamp(civ, 0, 100)^1.35 / 2.2 )) × (1 + warBonusPct/100) )
// warBonusPct = 10 for 7 days after winning a war, otherwise 0
```

| Civilization score | 0 | 10 | 15 | 25 | 35 | 50 | 55 | 75 | 90 | 100 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Territory cells | 6 | 16 | 23 | 41 | 61 | 95 | 107 | 160 | 203 | 233 |
| With +10% war bonus | 7 | 18 | 25 | 45 | 67 | 105 | 118 | 176 | 223 | 256 |

Territory is **cosmetic and positional only**. No score, production or war formula reads it. The UI's "Territory" rank sorts nations by this target cell count.

**The world** (`packages/shared/src/world/index.ts`). Every client derives the same world:

- **Grid.** 200 × 100 pointy-top hexes (odd-r offset) that wrap east to west, generated from the fixed seed `0x41544c53` ("ATLS").
- **Terrain.** Rows 0–4 and 95–99 are Ice. Otherwise elevation percentiles decide the terrain: ≥ 93rd is Highland, ≥ 60th is Land, ≥ 52nd is Shallows, and the rest is Ocean.
- **Claimable land.** Only Land and Highland can be claimed. With the canonical seed that is 7,993 of 20,000 cells (about 40%).

**Capital placement** (`placeCapitals`). Nations are placed in ascending nation id, which is founding order:

1. Each nation gets a pseudo-random sequence: an LCG (`state = state × 1664525 + 1013904223 mod 2³²`) seeded with the FNV-1a hash of its lower-cased token address.
2. For `minDist` from 7 down to 0, the engine tries up to 96 random land cells. It takes the first cell that is at least `minDist` hexes from every earlier capital (and not equal to one).
3. If the world is saturated, the nation shares a random land cell.

Earlier capitals never move when new nations are founded.

**Territory assignment** (`layoutWorld`), again in ascending id order:

1. The nation's radius is `r = max(1, smallest r with 3r² + 3r + 1 ≥ territoryCells)`.
2. A breadth-first search expands from the capital through **land cells only**, out to hex distance `r`. Ocean blocks expansion, and paths must stay on land.
3. Each reached cell scores `distance / (r + 0.5)`. A cell goes to the nation with the lowest score. On an exact tie the earlier-founded nation keeps it.
4. A capital always belongs to its own nation.

Because of coastlines and competition, the cells a nation actually holds on the map can differ from `territoryCells`. They never exceed the hexagon `3r² + 3r + 1`.

---

## 6. Ranks and leaderboards

**World rank** (`recomputeRanks`, `apps/indexer/src/game/state.ts`) orders nations by:

1. civilization score, descending;
2. then market cap, descending (nulls last);
3. then nation id, ascending (older first).

It is recomputed after every indexed block range and after every engine step that touched a nation. The previous rank is kept so the UI can show movement.

**Nation leaderboard categories** (`apps/web/src/app/leaderboard/page.tsx`). These are computed in the browser from `/api/world`, sorted descending (ties by nation id), and show the top 100:

| Category | Ranked by |
| --- | --- |
| 🏆 Overall Civilization | Civilization score |
| 🌎 Largest Economy | Market cap (ETH) |
| 👥 Most Citizens | Citizen count |
| ⚔️ Strongest Nation | Military power |
| 📈 Fastest Growing | 24h citizen growth: `citizens / citizens 24h ago − 1`, the same measure as the Discover page. Nations with no citizens 24 h ago are not ranked. |
| 🔥 Most Active | 24h trading volume (ETH) |
| 🏗️ Most Developed | Development score (ties broken by civilization score), shown as "n / 8" buildings |
| 👑 Most Influential | Influence **resource** (not the influence score) |

**Citizen leaderboard** (`/api/leaderboard/citizens`, `getTopCitizens`): addresses ranked by total XP using SQL `rank()`, each shown with its citizen rank title ([section 15](#15-player-progression)). The default limit is 50; the maximum is 200.

---

## 7. Game time: the engine and hourly epochs

The game engine (`apps/indexer/src/game/engine.ts`) runs after every chain-sync step. It advances a **game cursor** through time and processes three kinds of items in strict time order:

1. **Timed items.** Building completions (`completes_at`) and war endings (`ends_at`).
2. **Decrees.** `GameActionExecuted` events, ordered by `(timestamp, block_number, log_index)`.
3. **Epoch ticks.** Every multiple of `EPOCH_SECONDS = 3600` (one hour).

When several items share a timestamp, they run in that order: completions and war endings first, then decrees, then the epoch tick.

**The safe-time cursor.** Arbitrum produces several blocks with the same timestamp, so only times strictly before the newest indexed block's timestamp are known to be complete. The engine therefore only advances to `safe = last_block_timestamp − 1`. Each step processes at most 24 epochs (`MAX_EPOCHS_PER_STEP`), so catching up never starves the chain sync. A cursor of `0` triggers a full replay. The replay starts one second before the earliest nation's founding.

**What one epoch at boundary `E` does** (`tickEpoch`, `epoch.ts`). It runs for every nation founded before `E`:

1. **Snapshot.** It builds a snapshot "as of `E`" from the chain mirror:
   - price, market cap and liquidity after the last trade before `E` (or the opening curve price if there has been no trade);
   - citizens as of `E − 1`;
   - volume and trade count for `[E − 1h, E)`;
   - 24h volume (the previous 23 snapshots plus this hour);
   - the treasury balance.
2. **Market events.** It evaluates market events ([section 13](#13-world-events)) and updates statuses and cooldowns.
3. **Production.** It credits the hour's resource production ([section 8](#8-resources)).
4. **Time-based achievements.** It checks Enduring, Resilient, Empire and Emperor.

**Exactly once.** Every resource change carries a unique `ref` (`epoch:<E>`, `build:<proposalId>`, `war:<id>:spoils`, `war:<id>:loss`), and every news item carries a unique `dedupe_key`. Re-processing the same time range can never double-apply anything.

---

## 8. Resources

Nations hold four **game-only** resources: **influence, culture, energy, materials**. They are produced every hourly epoch, are integers, and can never go below zero. They cannot be bought, sold, transferred or withdrawn.

**Production per epoch** (`epochProduction`, `packages/shared/src/game/resources.ts`). Building flags are 1 if the building is complete.

| Resource | Formula |
| --- | --- |
| Materials | `round( (2 + 4·√citizens) × (1 + 0.25·Factory + 0.10·Port) )` |
| Energy | `round( (1 + 20·log10(1 + 1000·volume1h) + 10·log10(1 + 100·liquidity)) × (1 + 0.25·Port) )` |
| Culture | `round( 5·votesCast·(1 + 0.25·Stadium) + citizens^0.3 + 10·Stadium + 10·Monument )` |
| Influence | `round( (economicPower/10 + (goldenAge ? 20 : 0)) × (1 + 0.25·University + min(25, 5·allies)/100) )` |

The inputs come from the epoch snapshot:

| Input | Meaning |
| --- | --- |
| `citizens` | Citizens at `E − 1` |
| `volume1h` | ETH traded in `[E − 1h, E)` |
| `liquidity` | Liquidity in ETH |
| `votesCast` | Number of votes (one per address per proposal, any choice) cast on this nation's proposals during the hour |
| `economicPower` | The epoch's economic power |
| `allies` | Active alliance members − 1 |
| `goldenAge` | True while a Golden Age status is active. The epoch at which the Golden Age fires is not itself boosted. |

For example, a nation with 100 citizens, 1 ETH of liquidity, no trades, no votes, economic power 30 and no buildings produces 42 materials, 21 energy, 4 culture and 3 influence per hour.

**Consumption.** Resources are spent in only two ways:

- **Construction.** The full building cost is deducted when the decree is enacted.
- **War defeat.** The loser loses influence ([section 11](#11-wars)).

Resources do not decay. Every non-production change is recorded in a public ledger (`game_resource_ledger`), which the Infrastructure tab shows. Spending influence (on a Spaceport, or by losing a war) lowers the influence score.

---

## 9. Buildings

Buildings are proposed through governance ([section 10](#10-governance-proposing-voting-enacting)) and paid for with resources. They are defined in `BUILDINGS` in `constants.ts`. Each building type can exist **once** per nation, and buildings are permanent (nothing destroys them).

| # | Building | Cost | Build time | Requires (completed) | Min. citizens | Graduation required |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 🏛️ Capitol | 100 materials, 50 energy | 6 h | — | 1 | No |
| 1 | 🏦 Bank | 300 materials, 200 energy | 12 h | Capitol | 10 | No |
| 2 | 🏭 Factory | 300 materials, 150 energy | 12 h | Capitol | 10 | No |
| 3 | 🏫 University | 500 materials, 300 energy | 18 h | Capitol | 50 | No |
| 4 | 🏟️ Stadium | 800 materials, 400 energy | 24 h | Capitol | 100 | No |
| 5 | ⚓ Port | 800 materials, 600 energy | 24 h | Bank | 50 | **Yes** |
| 6 | 🗼 Monument | 1,500 materials, 1,000 energy, 500 culture | 36 h | Capitol | 100 | No |
| 7 | 🚀 Spaceport | 4,000 materials, 4,000 energy, 1,000 influence | 72 h | University, Factory, Bank | 1,000 | **Yes** |

**Effects as implemented.** Multipliers within a stat are additive, and every stat is still capped at 100. Every completed building also adds 12.5 to the development score.

| Building | Effects in code |
| --- | --- |
| Capitol | Military ×(+5%), defense ×(+10%). It is a prerequisite (directly or indirectly) for every other building. |
| Bank | Economic power ×(+10%) |
| Factory | Materials production ×(+25%), military ×(+10%) |
| University | Influence production ×(+25%) |
| Stadium | +10 culture per hour; governance culture (`5 × votes`) ×1.25 |
| Port | Energy production ×(+25%), materials production ×(+10%), economic power ×(+5%) |
| Monument | +10 culture per hour, defense ×(+10%) |
| Spaceport | Civilization score ×1.1. The "spacefaring capital" is a visual change in the capital view. |

**Construction lifecycle** (`actions.ts`, `timed.ts`):

1. A Build decree is executed on-chain. The engine then validates it at the execution timestamp, in this order:
   - the building type is known;
   - it is not already built;
   - it is not already under construction;
   - every prerequisite is *complete*;
   - citizens as of that moment are at least the minimum;
   - the nation has graduated, if required;
   - the nation can afford the full cost.
2. If the decree is valid, the cost is deducted immediately and construction starts. It completes `buildHours` later. Different building types can be under construction at the same time.
3. On completion the building starts counting toward stats and production. The nation gets **First Stone** on its first building, **Wonder of the World** for a Monument, and **Spacefaring** for a Spaceport. When a Spaceport completes, every citizen at that moment gets **Space Pioneer**.
4. If the decree is invalid, it is rejected ([section 10](#10-governance-proposing-voting-enacting)). Nothing is spent.

---

## 10. Governance: proposing, voting, enacting

All national decisions are on-chain proposals in `AtlasGovernor`, one contract for every nation. Proposal ids are global and sequential, and they double as war ids and alliance ids.

**Proposal kinds** (`AtlasGovernor.sol`):

| Kind | Payload | Voting period | Quorum (of total supply at snapshot) | Timelock | What execution does |
| --- | --- | --- | --- | --- | --- |
| **Treasury** | `(recipient, amountWei)` | 3 days | 4% | 1 day | `NationTreasury.release`, capped at 25% of the balance ([section 16](#16-the-national-treasury)) |
| **GameAction** | `(action, arg, text)` | 1 day | 1% | none | Emits `GameActionExecuted`. The off-chain engine then applies it under these rules. |
| **Symbol** | `(emblem, metadataURI)` | 1 day | 1% | none | `AtlasLaunchpad.setNationSymbol`: the flag and metadata change on-chain |

**Common rules:**

- **Proposal threshold.** The proposer needs voting power of at least **0.1% of total supply** (`PROPOSAL_THRESHOLD_BPS = 10`), measured at the snapshot.
- **Snapshot.** The snapshot is `block.timestamp − 1` at creation. Tokens acquired at or after creation cannot vote on that proposal.
- **Voting.** Votes are `0` against, `1` for, or `2` abstain. Each address votes once, and its weight is its ERC20Votes balance at the snapshot. A vote reason is at most 280 bytes; a description at most 2,000 bytes.
- **Passing.** A proposal passes when `for > against` **and** `for + abstain ≥ quorum`. A tie is defeated.
- **States.** A proposal is Active until `voteEnd` (inclusive), then either Defeated or Queued (until the ETA, treasury only), then Executable. It becomes Expired if it is not executed within **7 days after its ETA**. The proposer may cancel while it is Active.
- **Execution** is permissionless. Anyone may call `execute`.

**Game actions and their on-chain payload checks** (made when the proposal is *created*):

| Action | `arg` | `text` | Checked on-chain at proposal time |
| --- | --- | --- | --- |
| Build | building type id | empty | `arg < 8` |
| DeclareWar | target nation id | empty | target exists and is not the proposing nation |
| CreateAlliance | — | alliance name | name is 2–32 bytes. The new alliance's id equals this proposal's id. |
| InviteToAlliance | invited nation id | empty | target exists and is not the proposing nation |
| JoinAlliance | alliance id | empty | `arg` is an executed CreateAlliance proposal |
| LeaveAlliance | alliance id | empty | `arg` is an executed CreateAlliance proposal |

**Enactment by the engine.** The contract does not know the game state, so it cannot judge whether a decree is still valid. The engine re-validates every executed GameAction against the game state **at the execution block's timestamp**, which can be up to 7 days after voting ends. The rules are those in sections [9](#9-buildings), [11](#11-wars) and [12](#12-alliances).

- **Valid decree.** The engine applies it and records `applied` in `game_actions`.
- **Invalid decree.** The engine records `rejected` with the exact reason and publishes a **DECREE REJECTED** news item. It changes no game state and spends no resources. The proposal remains `Executed` on-chain, and the proposal page shows the rejection reason. A rejected decree is never retried; citizens must pass a new proposal.

Each decree is applied at most once, keyed by proposal id. A CreateAlliance decree the engine rejected still counts on-chain as an "alliance" for payload checks. Any later Join for that id is rejected by the engine with "Alliance does not exist or has dissolved."

Treasury and Symbol proposals are enacted entirely on-chain by the contracts. The engine only reports them in the news.

---

## 11. Wars

Wars are 48-hour contests decided **deterministically** by measurable metrics. No tokens or ETH change hands, and there is no betting.

**Declaration rules** (`validateWarDeclaration`, checked at enactment):

| Rule | Value |
| --- | --- |
| Target | Must exist, and cannot be yourself |
| Alliances | Members of the same alliance cannot declare war on each other |
| Duplicates | No new war while one is already active between the pair (in either direction) |
| Active-war limit | The limit applies only to the declaring nation: it may not declare while it already has **2** active wars, counting wars it attacks or defends. The defender's count is not checked. The rejection reason is "A nation already fighting 2 wars cannot declare another." |
| Rematch cooldown ("peace treaty") | 72 hours after the last war between the same pair ended |
| Duration | 48 hours from the execution timestamp |

**At declaration** the engine records each side's citizens (as of that moment) and market cap (from the last trade, or the opening curve market cap if there has been none). Everyone who voted *for* the declaration gets **War Veteran**.

**At the end** (`declared_at + 48h`) the engine measures both sides as of the end time:

- citizens and market cap;
- ETH volume traded during `[declared_at, ends_at)`;
- economic and defensive power;
- current allies.

It then scores each side (`warScore` in `rules.ts`):

| Component | Max | Formula |
| --- | --- | --- |
| Population growth | 30 | `30 × (clamp(g, −0.5, 1) + 0.5) / 1.5`, where `g = citizensEnd/citizensStart − 1` (if the start is 0: `g = 1` when the end is > 0, else 0) |
| Market momentum | 25 | `25 × (clamp(m, −0.5, 1) + 0.5) / 1.5`, where `m = mcapEnd/mcapStart − 1` (0 if the start is 0) |
| Trading activity | 25 | `25 × logScore(warVolumeEth, 0.001, 1 000)` |
| Economic power | 20 | `20 × economicPowerEnd / 100` |
| Defense (defender only) | 10 | `10 × defensivePowerEnd / 100` |
| Alliance bonus | +10% | `subtotal × min(10, 2 × allies) %` |

A side with no change and no activity therefore scores 10 (growth) + 8.33 (momentum).

**Winner.** The attacker wins only if its total is strictly greater than the defender's. **Ties go to the defender.**

**Outcomes:**

| Effect | Value |
| --- | --- |
| Spoils | `max(50, floor(loser's influence × 10%))` |
| Winner | Gains the spoils as influence, gets +1 war win (which feeds military power), and gets **+10% territory for 7 days** (the window restarts from the most recent win). First win unlocks **First Victory**. |
| Loser | Loses `floor(spoils / 2)` influence (never below 0) and gets +1 war loss |

The final score breakdown is stored and published in a WAR ENDED news item. The war page shows a live *projection* while a war is active. That projection uses live summary values and counts allies the way the engine does (current alliance members − 1), but it is only an estimate: only the engine's final resolution counts.

---

## 12. Alliances

| Constant | Value |
| --- | --- |
| Maximum members | 6 nations |
| Invitation validity | 14 days |
| Influence production bonus | +5% per ally, maximum +25% |
| War score bonus | +2% per ally, maximum +10% |

"Allies" means the alliance's active members minus the nation itself.

| Decree | Valid at enactment when… | Result |
| --- | --- | --- |
| **CreateAlliance** | The nation is not in an alliance and the trimmed name has at least 2 characters | A new alliance with id = proposal id, led by this nation, which is its first member. The nation gets **Diplomacy**; *for* voters get **Diplomat**. |
| **InviteToAlliance** | The inviter is in an active alliance and is its **leader**; the invitee exists and is not already a member; the alliance has fewer than 6 members | Creates or refreshes an invitation for 14 days. Citizens of the invitee must then pass a JoinAlliance decree. |
| **JoinAlliance** | The alliance exists and is active; the nation is in no alliance; it holds an invitation that is ≤ 14 days old; the alliance has fewer than 6 members; the nation is not in an active war with any member | The nation becomes a member and the invitation is consumed. It gets **Diplomacy**; *for* voters get **Diplomat**. |
| **LeaveAlliance** | The nation is a member of that alliance | The nation leaves. If the leader left, leadership passes to the earliest-joined remaining member. If no members remain, the alliance dissolves. |

Alliances do not pool resources, and allies do not automatically join each other's wars. The only mechanical effects are the two per-ally bonuses and the ban on wars between members. There is no way to expel a member.

---

## 13. World events

All world events come from indexed chain data and fire at most once per cooldown per nation. Market events are evaluated at each hourly epoch `E` (`detectMarketEvents`, `events.ts`). Price changes compare the epoch price with this nation's snapshot from 1 hour or 24 hours earlier. "Previous ATH" means the highest market cap among the nation's earlier hourly snapshots; "ATH liquidity" means the same for liquidity.

| Event | Severity | Trigger (exact) | Cooldown | Status shown | Game effect |
| --- | --- | --- | --- | --- | --- |
| 🚀 **Economic Boom** | notable | mcap ≥ 0.1 ETH, ≥ 1 trade in the hour, a 1h-ago snapshot exists, and the 1h price change is ≥ +10% | 6 h | 3 h | none (display only) |
| 📉 **Market Crash** | notable | Same gates, and the 1h price change is ≤ −20% | 6 h | 3 h | none |
| 👑 **Golden Age** | major | mcap ≥ 0.1 ETH, mcap > previous ATH × 1.05 (previous ATH > 0), and the 24h price change is ≥ +50% | 48 h | 24 h | **+20 base influence per epoch** while active, and the **Golden Age** achievement |
| 📈 **Record Economy** (record high) | minor | Same new-ATH condition, but the Golden Age 24h condition is not met. If Golden Age qualifies but is on cooldown, neither event fires. | 12 h | — | none |
| 🌩️ **Economic Crisis** | major | mcap ≥ 0.1 ETH and the 24h price change is ≤ −50% | 48 h | 24 h | none directly. It starts the 7-day clock for **Resilient**. |
| 👥 **Population Explosion** | notable | A 24h-ago snapshot with > 0 citizens exists, the nation gained ≥ 25 citizens, and citizens are ≥ 1.25 × the day-ago count | 24 h | — | none |
| 🔥 **Trade Festival** | notable | Volume this hour is ≥ 0.25 ETH **and** ≥ 5 × the average hourly volume of the previous 23 hours | 12 h | 3 h | none |
| ⚠️ **Banking Crisis** | notable | A 24h-ago snapshot has liquidity ≥ 0.1 ETH, and current liquidity is ≤ 50% of it | 24 h | — | none |
| ☠️ **National Emergency** | major | The nation graduated before `E`, ATH liquidity is ≥ 0.5 ETH, and current liquidity is < 10% of ATH liquidity | 72 h | 24 h | none |
| 🐋 **Foreign Investment** (whale) | notable | Evaluated **per buy trade** during chain sync: ETH spent is ≥ 0.25 **and** ≥ 3% of the market cap before the trade | 1 h | — | none |

**Statuses.** Statuses are timed flags (`statuses` on the nation). The UI uses them for header badges, map glow and the capital sky. Firing the same status again replaces its timer. Only **Golden Age** changes game numbers (+20 base influence production).

**Milestones** (chain sync, `metrics.ts`). Each fires once per nation, ever:

| Milestone | Values | Trigger |
| --- | --- | --- |
| 👥 Population milestone | 10, 100, 1,000, 10,000, 100,000 citizens | The live citizen count crosses the value upward. 100, 1,000 and 10,000 also unlock achievements. |
| 💰 Economic milestone | 1, 10, 100, 1,000, 10,000 ETH | Market cap rises past the value above the previous all-time high. 100 ETH also unlocks an achievement. |

---

## 14. Atlas News

Every news item is a row in `game_events`. Each has a type, a severity (`minor`, `notable` or `major`, fixed per type in `EVENT_TYPES`), a headline, a body, the nations involved, a transaction hash where there is one, and a unique `dedupe_key`. Inserting the same key twice is a no-op. Items are published in real time and served by `/api/news`, which can filter by nation, by minimum severity, and by paging.

| Type | Headline label | Severity | Produced by | Trigger |
| --- | --- | --- | --- | --- |
| FOUNDED | NATION FOUNDED | notable | chain sync | `NationFounded` |
| GRADUATED | JOINED WORLD MARKETS | notable | chain sync | `NationGraduated` |
| ECONOMIC_BOOM, MARKET_CRASH, POPULATION_EXPLOSION, TRADE_FESTIVAL, BANKING_CRISIS | as in section 13 | notable | engine epoch | [Section 13](#13-world-events) |
| GOLDEN_AGE, ECONOMIC_CRISIS, NATIONAL_EMERGENCY | as in section 13 | major | engine epoch | [Section 13](#13-world-events) |
| RECORD_HIGH | RECORD ECONOMY | minor | engine epoch | [Section 13](#13-world-events) |
| FOREIGN_INVESTMENT | FOREIGN INVESTMENT | notable | chain sync | Whale buy |
| CITIZEN_MILESTONE | POPULATION MILESTONE | notable | metrics refresh | Citizen milestone |
| MCAP_MILESTONE | ECONOMIC MILESTONE | notable | metrics refresh | Market cap milestone |
| WAR_DECLARED | WAR DECLARED | major | engine | Applied DeclareWar |
| WAR_ENDED | WAR ENDED | major | engine | War resolution |
| ALLIANCE_FORMED | ALLIANCE FORMED | notable | engine | Applied CreateAlliance |
| ALLIANCE_INVITE | DIPLOMATIC INVITATION | minor | engine | Applied InviteToAlliance |
| ALLIANCE_JOINED | ALLIANCE EXPANDED | notable | engine | Applied JoinAlliance |
| ALLIANCE_LEFT | ALLIANCE BROKEN | notable | engine | Applied LeaveAlliance |
| BUILDING_STARTED | CONSTRUCTION STARTED | minor | engine | Applied Build |
| BUILDING_COMPLETED | CONSTRUCTION COMPLETE | notable | engine | Construction finished |
| ACTION_REJECTED | DECREE REJECTED | minor | engine | GameAction invalid at enactment |
| PROPOSAL_CREATED | NEW PROPOSAL | minor | chain sync | `ProposalCreated` |
| TREASURY_RELEASE | TREASURY SPENDING | notable | chain sync | `NationTreasury.Released` |
| SYMBOL_CHANGED | NEW NATIONAL SYMBOL | minor | chain sync | Executed Symbol proposal |
| ACHIEVEMENT | ACHIEVEMENT | minor | chain sync or engine | A **nation** achievement unlocked. Citizen achievements are not published. |

There is no news item for an executed proposal as such. Executions show up through their effects (for example SYMBOL_CHANGED, TREASURY_RELEASE, or the engine's news for an applied or rejected decree).

Engine-generated items use `g:`-prefixed dedupe keys, which are rebuilt on replay:

- `g:build:`, `g:built:`, `g:war:`, `g:warend:`, `g:alliance:`, `g:invite:`, `g:join:`, `g:leave:`, `g:action:` (each followed by an id);
- `g:mkt:<TYPE>:<nation>:<epoch>` for market events.

Chain-sync items use keys such as `found:`, `graduated:`, `whale:`, `proposal:`, `symbol:`, `release:`, `citizens:`, `mcap:` and `nation-ach:`.

---

## 15. Player progression

Citizens (wallet addresses) earn **XP** for participation. XP is never bought, and the amount held or spent does not change it (`XP` in `achievements.ts`; awarded in `apps/indexer/src/sync/post.ts` and `game/progress.ts`).

| Source | XP | Once per |
| --- | --- | --- |
| Found a nation | 500 | nation |
| Become a citizen of a nation (balance crosses the threshold) | 50 | address × nation |
| Cast a governance vote | 25 | address × proposal |
| Create a proposal | 50 | proposal |
| Your proposal is executed on-chain (any kind) | 100 | proposal |
| Unlock a citizen achievement | 100 | address × achievement |
| Citizenship days | 5 per full day, up to 30 days (150 XP) per nation | Computed when profiles and leaderboards are read, over *current* citizenships, from the start of the address's current holding period for that token, measured against the indexed chain time (the latest indexed block's timestamp) |

The "proposal executed" XP is paid when the governor executes the proposal, including a GameAction the engine later rejects.

**Citizen ranks** (`CITIZEN_RANKS`):

| XP | Rank |
| --- | --- |
| 0 | Settler |
| 500 | Citizen |
| 2,000 | Statesman |
| 10,000 | Legend |

**Profile titles** come from these achievements: 🏛️ Founder, ⚔️ War Veteran, 🌎 Diplomat, 💰 Industrialist, 🚀 Space Pioneer, 👑 Emperor.

**Nation achievements.** Each unlocks once per nation and publishes an ACHIEVEMENT news item.

| Code | Name | Rarity | Unlocks when (as implemented) |
| --- | --- | --- | --- |
| NATION_FOUNDED | A Nation Is Born | common | The nation is founded |
| CITIZENS_100 | Township | common | Live citizens cross 100 |
| CITIZENS_1000 | Thriving City | rare | Live citizens cross 1,000 |
| CITIZENS_10000 | Great Nation | epic | Live citizens cross 10,000 |
| GRADUATED | World Markets | rare | The curve sells out and liquidity moves to Uniswap |
| MCAP_100_ETH | Economic Power | epic | Market cap crosses 100 ETH (above the previous ATH) |
| MCAP_1M_USD | Millionaire Economy | epic | Market cap × the indexer's ETH/USD reference price is ≥ $1,000,000. This needs `ETH_USD_SOURCE=coinbase`; without a price it never unlocks. |
| FIRST_BUILDING | First Stone | common | The first building completes |
| FIRST_MONUMENT | Wonder of the World | rare | A Monument completes |
| SPACEFARING | Spacefaring | legendary | A Spaceport completes |
| FIRST_VICTORY | First Victory | rare | The nation wins a war |
| JOINED_ALLIANCE | Diplomacy | common | A CreateAlliance or JoinAlliance decree is applied |
| GOLDEN_AGE | Golden Age | epic | A Golden Age event fires |
| SURVIVED_CRISIS | Resilient | rare | At an epoch at least 7 days after the most recent Economic Crisis, with ≥ 10 citizens and ≥ 1 trade in the last 7 days |
| SURVIVED_30_DAYS | Enduring | common | At an epoch at least 30 days after founding, with ≥ 10 citizens |
| EMPIRE | Empire | legendary | Tier ≥ 4 (Empire) at an epoch |

**Citizen achievements.** Each unlocks once per address and awards 100 XP.

| Code | Name | Rarity | Unlocks when (as implemented) |
| --- | --- | --- | --- |
| FOUNDER | Founder | rare | The address founds a nation |
| FIRST_CITIZENSHIP | Citizen | common | Its balance first crosses a nation's citizen threshold |
| WORLD_CITIZEN | World Citizen | rare | When it becomes a citizen somewhere, it is then a citizen of ≥ 5 nations |
| EARLY_SETTLER | Early Settler | common | It becomes a citizen within 24 h of that nation's founding |
| FIRST_VOTE | Voice of the People | common | It casts its first vote |
| FIRST_PROPOSAL | Statesman | common | It creates its first proposal |
| WAR_VETERAN | War Veteran | rare | It voted *for* a DeclareWar decree that the engine applied |
| DIPLOMAT | Diplomat | rare | It voted *for* a CreateAlliance or JoinAlliance decree that the engine applied |
| INDUSTRIALIST | Industrialist | rare | It voted *for* 3 Build decrees that the engine applied |
| SPACE_PIONEER | Space Pioneer | epic | It was a citizen of a nation when that nation's Spaceport completed |
| EMPEROR | Emperor | legendary | It founded a nation that reached the Empire tier |

---

## 16. The national treasury

Each nation has an isolated ETH account in `NationTreasury`. The treasury holds real ETH, but it is **not an input to any game formula**. Its balance is only displayed.

**Income:**

- **Bonding-curve trades.** Every curve buy and sell pays a **1%** fee in ETH. Half (0.5% of the trade value) is deposited into the nation's treasury; the other half goes to the protocol fee recipient.
- **Donations.** Anyone may call `deposit(nationId)`. A plain ETH transfer to the contract reverts.
- **Not income:** after graduation, trades happen on Uniswap V2. AtlasPad takes no fee on them and the treasury receives nothing from them. The nation-creation fee goes to the protocol, not the treasury.

**Spending:**

- **Only by governance.** Funds leave only when `AtlasGovernor` executes a passed **Treasury** proposal of that nation (3-day vote, 4% quorum, 1-day timelock). There is no owner and no developer access.
- **Per-proposal cap.** A single release can be at most **25%** of the nation's treasury balance *at execution time* (`MAX_RELEASE_BPS = 2500`). If the requested amount exceeds the cap, execution reverts and the proposal stays unexecuted until it succeeds or expires.
- **Valid recipients.** The recipient cannot be the zero address or the treasury itself, and the amount must be > 0.

---

## 17. On-chain vs off-chain state, replay and rebuild

| On-chain (contracts) | Off-chain, derived by the indexer (rebuildable) |
| --- | --- |
| Nations, tokens, supply, balances, emblem and metadata URI | Citizen counts, statistics, tiers, territory size, ranks |
| Bonding-curve state, graduation, the Uniswap V2 pool | Resources and the resource ledger |
| Proposals, votes, execution, `GameActionExecuted` decree records | Buildings, wars, alliances, invitations |
| Treasury balances, deposits and releases | Hourly snapshots, market events, statuses, Atlas News |
| | Achievements and XP |

The engine reads only the indexed mirror of chain events (`trades`, `transfers`, `votes`, `game_action_events` and so on). It never sends transactions. Live metrics use the latest indexed block's timestamp, not wall-clock time.

**Reorgs.** The indexer stays `INDEXER_CONFIRMATIONS` blocks (default 2) behind the head. If a stored block hash no longer matches the chain, it:

1. finds the fork point;
2. deletes mirror rows after it, plus the news, nation and citizen achievements and XP recorded after it (they are re-derived by re-sync, metric refreshes and the game replay);
3. rebuilds holder balances from the remaining transfers, with each holder's start date set to the start of its current holding period, as in live sync;
4. restores curve and pool state from the chain;
5. sets the game cursor to 0, which forces a full deterministic replay.

**Rebuild command:**

```sh
pnpm --filter @atlaspad/indexer rebuild-game     # apps/indexer/src/rebuild.ts
```

This sets `game_cursor = 0` and steps the engine until the cursor reaches `last_block_timestamp − 1`.

| Reset wipes and replays | Reset does not touch |
| --- | --- |
| `game_snapshots`, `game_resource_ledger`, `game_actions`, `game_buildings`, `game_wars`, `game_alliances`, `game_alliance_members`, `game_alliance_invites` | Nation and citizen achievements, citizen XP |
| All `g:`-keyed news | Chain-sync news (founding, graduation, proposals, releases, symbols, whales, milestones, achievement news) |
| Each nation's resources, war wins and losses, alliance, war territory bonus, statuses and market-event cooldowns | The Foreign Investment (whale news) cooldown, which belongs to chain sync |

The untouched items are insert-once and idempotent. The replay re-attempts engine achievements, which are no-ops if they already exist. The integration test `game state replays deterministically` checks that a full replay reproduces identical resources, war results, snapshots and engine news.

---

## 18. Fairness notes

- **No pay-to-win purchases.** No contract or API sells resources, buildings, XP or game advantages. Resources come only from hourly production and war spoils. They are spent only on construction and lost only in defeats.
- **Buildings change game numbers, not token economics.** A building affects only:
  - derived game scores (economic, military, defensive and civilization multipliers, and the development score);
  - resource production.

  Buildings never touch token supply, price, the bonding curve, liquidity, fees, voting power or treasury ETH. Executing a GameAction on-chain only emits an event, and the engine that interprets it is off-chain and never writes to the chain.
- **Wars are skill-and-activity contests, not gambles.** The outcome is a fixed formula over growth, momentum, trading activity, economic power, defense and allies. Ties go to the defender. Only influence, the win/loss record and a 7-day map-territory bonus change. No tokens or ETH are at stake, and AtlasPad offers no betting on outcomes.
- **Market activity is an input, by design.** Economic power, military power, war scores, energy and influence production, and most world events are computed from real market data: market cap, liquidity, volume and citizens. Trading and holding a nation's token therefore *does* move its game standing. What cannot be bought is any in-game resource or effect outside those published formulas.
- **Counting is per address.** Citizens and the culture earned from votes are counted per address (one vote per address per proposal, regardless of weight). Voting *outcomes* are token-weighted.
- **XP is flat.** XP comes in fixed amounts for founding, citizenship, voting, proposing and achievements. It does not scale with the amount held or spent.
- **One off-chain dependency.** The **Millionaire Economy** achievement uses an off-chain ETH/USD reference price. It is the only game outcome that is not a pure function of chain data.

---

## Appendix A: the founding curve

`AtlasLaunchpad` sells each nation's curve allocation on a constant-product curve with virtual reserves (`_initCurve`, ported exactly in `packages/shared/src/game/curve.ts`).

```
S = total supply      L = LP reserve = 20% of S      F = founder allocation = 0–5% of S
C = curve supply = S − L − F      R = graduationEth (immutable per deployment)

virtualTokens₀ = C² / (C − L)        virtualEth₀ = R·L / (C − L)
k = virtualEth · virtualTokens       (constant while trading; fees excluded)
```

Selling the whole curve allocation leaves `virtualTokens = C·L/(C − L)` and `virtualEth = R·C/(C − L)`. So:

- the curve raises exactly `R` ETH (net of fees);
- the final curve price is `R / L`, which is exactly the Uniswap V2 opening price when `R` ETH and `L` tokens seed the pool.

With no founder allocation, the opening market cap is 31.25% of `R` and the graduation market cap is 5 × `R` (verified in `packages/shared/test/curve.test.ts`).

Trades pay a 1% ETH fee, split 0.5% to the treasury and 0.5% to the protocol. A buy that would overshoot the remaining curve supply is capped and the excess ETH is refunded, which triggers graduation. Only tokens that the curve itself sold can be sold back into it; founder tokens cannot be claimed until after graduation, when the curve is closed.
