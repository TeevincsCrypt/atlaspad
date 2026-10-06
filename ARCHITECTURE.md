# AtlasPad Architecture

AtlasPad is an on-chain civilization game: every token is a nation and every holder is a citizen. The
contracts target **Robinhood Chain mainnet** (Arbitrum Orbit L2, chainId `4663`, ETH as the gas token). Local
development uses **anvil** (chainId `31337`) with ported Uniswap V2 and WETH9 mocks.

This document describes what is in the repository. It covers the contracts, the indexer, the database, the
web app, the 3D world renderer and the tests.

---

## 1. System overview

```
                 Robinhood Chain 4663  (or anvil 31337 for local dev)
 ┌────────────────────────────────────────────────────────────────────────────────┐
 │ AtlasLaunchpad ──(NationTokenFactory, CREATE2)──► NationToken  (one per nation)│
 │   bonding curve · fees · graduation ──► Uniswap V2 pair (LP minted to 0x…dEaD) │
 │ AtlasGovernor ──► NationTreasury.release()  /  AtlasLaunchpad.setNationSymbol() │
 │ NationTreasury (per-nation ETH accounts)                                        │
 └───────────▲─────────────────────────────────────────────┬──────────────────────┘
             │ wallet txs + live reads                     │ eth_getLogs / getBlock /
             │ (wagmi + viem: simulate, write, receipt)    │ getTransaction / readContract
             │                                             ▼
 ┌───────────┴───────────────────────┐         ┌──────────────────────────────────────┐
 │ Browser (apps/web client)         │         │ apps/indexer  (one Node process)     │
 │  React Query caches               │         │  ChainSync ─► applyBatch (1 DB tx)   │
 │  zustand UI store                 │         │      └─► postProcess (news/XP/       │
 │  r3f world (WorldStage)           │◄── SSE ─┤          achievements/metrics/ranks) │
 │  effects bus ─► particles/camera  │ /stream │  GameEngine (hourly epochs, decrees, │
 └───────────┬───────────────────────┘         │          buildings, wars)            │
             │ fetch /api/*  (JSON)            │  RealtimeBus (in-process EventEmitter)│
             ▼                                 │  HTTP: /health /stream /admin/status │
 ┌───────────────────────────────────┐         └───────────────┬──────────────────────┘
 │ apps/web server (Next.js 16)      │                         │ read + write
 │  app/api/* route handlers         │   read-only SQL         ▼
 │  lib/server/* + @atlaspad/db/     ├────────────────► ┌──────────────┐
 │  queries (postgres.js)            │                  │  PostgreSQL  │
 │  proxy.ts (admin Basic auth)      │                  │ packages/db  │
 └───────────────────────────────────┘                  └──────────────┘
                                         optional: api.coinbase.com ETH-USD spot
                                         (indexer, ETH_USD_SOURCE=coinbase)
```

The contracts are the source of truth. The indexer is the only process that writes to the database. The web
server only reads from it. Browsers send transactions straight to the chain through the user's wallet.

---

## 2. Monorepo layout

pnpm workspaces (`pnpm-workspace.yaml`: `apps/*`, `packages/*`). `contracts/` is a Foundry project. It is not
a pnpm package.

| Path | Package | Purpose | Stack |
|---|---|---|---|
| `apps/web` | `@atlaspad/web` | Website, `/api` route handlers and the 3D world | Next.js 16 (App Router), React 19, Tailwind v4 (`@tailwindcss/postcss`), wagmi 2 + viem, three + @react-three/fiber/drei/postprocessing, gsap, motion, lightweight-charts, zustand, @tanstack/react-query, postgres.js, lucide-react |
| `apps/indexer` | `@atlaspad/indexer` | Chain sync, game engine, SSE server | Node ≥20 TypeScript, viem, postgres.js, drizzle-orm (migrator only), built with tsup, run in dev with tsx |
| `packages/shared` | `@atlaspad/shared` | Code used by both web and indexer: chains, network config, ABIs, formatting, DTO types, game rules, world/hex math | TypeScript sources (exports `.`, `./abis`, `./game`, `./world`), viem |
| `packages/db` | `@atlaspad/db` | Drizzle schema, SQL migrations (`packages/db/drizzle`), raw-SQL read queries shared by web and indexer | drizzle-orm, drizzle-kit, postgres.js |
| `contracts` | — | Solidity 0.8.28 contracts, Foundry tests and scripts. Submodules: `lib/forge-std`, `lib/openzeppelin-contracts` | Foundry (`evm_version = cancun`) |
| `scripts/dev-local.sh` | — | Starts the full local stack (anvil, deploy + seed, indexer, web) | bash |

The workspace packages ship TypeScript source, not compiled output. The web app compiles them through
`transpilePackages` in `next.config.ts`. The indexer bundles them through tsup `noExternal: [/^@atlaspad\//]`.
The indexer build also copies `packages/db/drizzle` into `dist/drizzle` so the bundle can run migrations.

There are two lint configs:

- the root `eslint.config.mjs` (`@eslint/js` + `typescript-eslint`, root devDependencies) for `shared`, `db`
  and `indexer`
- `apps/web/eslint.config.mjs` (`eslint-config-next`) for the web app

### Root scripts (`package.json`)

| Script | Runs |
|---|---|
| `dev` / `dev:indexer` | `next dev --port 3000` / `tsx watch src/main.ts` (loads `.env.local` and `../../.env` if present) |
| `dev:local` | `bash scripts/dev-local.sh` |
| `build`, `typecheck`, `lint`, `test` | `pnpm -r run <script>` across the workspaces |
| `e2e` | `node apps/web/e2e/flows.e2e.mjs` |
| `contracts:build` / `contracts:test` | `forge build` / `forge test -vv` |
| `contracts:abi` | `node packages/shared/scripts/export-abis.mjs` |
| `db:generate` / `db:migrate` | `drizzle-kit generate` / `tsx packages/db/src/migrate.ts` |

### ABI pipeline

```
contracts/src/*.sol ──forge build──► contracts/out/<Name>.sol/<Name>.json
   ──scripts/export-abis.mjs──► packages/shared/src/abis/generated.ts
        (atlasLaunchpadAbi, atlasGovernorAbi, nationTreasuryAbi, nationTokenAbi — `as const`)
```

`packages/shared/src/abis/index.ts` re-exports these and adds hand-written minimal ABIs for the Uniswap V2
pair (`getReserves`, `token0/1`, `Swap`, `Sync`), the router (`getAmountsOut`, `swapExact*`) and the factory
(`getPair`).

### `packages/shared` contents

| Module | Contents |
|---|---|
| `chains.ts` | `robinhoodChain` (4663, public RPC, Blockscout explorer), `anvilChain` (31337), canonical Robinhood Uniswap V2 factory/router and WETH, `BURN_ADDRESSES` |
| `config.ts` | `resolveNetwork()` builds an `AtlasNetworkConfig` (chain, rpcUrl, explorer, dex, `contracts \| null`, deployBlock) from raw env values. Throws `ConfigError`. Also explorer link helpers |
| `abis/` | Generated and minimal ABIs (see above) |
| `types.ts` | DTOs shared by the API and the SSE stream (`NationSummary`, `NewsItem`, `TradeDTO`, `ProposalDTO`, `WorldResponse`, `RealtimeMessage`, …). Convention: `null` = data unavailable |
| `format.ts` | ETH/USD/percent/compact/duration/time-ago formatting, `weiToEth`, `shortAddress` |
| `game/constants.ts` | Themes, enums that mirror the contracts (`GameAction`, `ProposalKind`, `ProposalState`), buildings, tiers, `EPOCH_SECONDS = 3600`, `WAR`, `ALLIANCE`, `GOVERNANCE` |
| `game/stats.ts`, `resources.ts`, `rules.ts`, `events.ts`, `achievements.ts` | Stat formulas (`computeStats`), hourly production, decree validation (`validateBuild`, `validateWarDeclaration`, alliance rules), war scoring (`resolveWar`), market-event detection (`detectMarketEvents`, `isWhaleBuy`, milestones), achievements, XP values, citizen ranks |
| `game/curve.ts` | Exact bigint port of the launchpad curve math. Used to preview a nation before it exists. For existing nations the contract's `quoteBuy`/`quoteSell` are authoritative |
| `game/proposals.ts`, `emblem.ts` | Proposal payload encode/decode, emblem bit-packing |
| `world/index.ts` | Deterministic world: 200 × 100 hex grid (20,000 cells), seeded noise terrain that wraps east–west, capital placement from a hash of each token address in founding order, territory assignment by bounded BFS |

---

## 3. Data architecture

### 3.1 On-chain: authoritative state

| Contract | Holds / does | Events consumed by the indexer |
|---|---|---|
| `AtlasLaunchpad` | Nation registry, constant-product bonding curve with virtual reserves, 1% trade fee (0.5% protocol, 0.5% to the nation treasury), founder vesting (30 days), graduation into Uniswap V2 (LP tokens minted to `0x…dEaD`). Symbol updates are allowed only from `AtlasGovernor`. No owner, no pause | `NationFounded`, `CurveInitialized`, `Trade`, `NationGraduated`, `NationSymbolUpdated` (`FounderTokensClaimed` and `ProtocolFeesWithdrawn` are decoded and ignored) |
| `NationTokenFactory` | Deploys `NationToken` with CREATE2 (salt = nation id). Only the launchpad can call it | — |
| `NationToken` | ERC20 + ERC20Permit + ERC20Votes with a timestamp clock. Fixed supply is minted to the launchpad. Holders are self-delegated automatically. Transfers to the pair revert until graduation | `Transfer` |
| `AtlasGovernor` | Per-nation proposals of three kinds: Treasury, GameAction, Symbol. Token-weighted votes, quorum, timelock, permissionless execution | `ProposalCreated`, `VoteCast`, `ProposalCanceled`, `ProposalExecuted`, `GameActionExecuted` |
| `NationTreasury` | Per-nation ETH accounts. Releases only through the governor, capped at 25% per release | `Deposited`, `Released` |
| Uniswap V2 pair (external) | Post-graduation market | `Sync`, `Swap` (graduated pairs only) |

For anything that moves money, the web app reads the chain directly: `quoteBuy`, `quoteSell`, `spotPrice`,
`balanceOf`, `allowance`, `nonces`, `getVotes`, `getPastVotes`, `proposalThreshold`, `hasVoted`,
`isNameAvailable` and `isSymbolAvailable`, plus router `getAmountsOut`. Database values are only for display
and discovery.

### 3.2 Off-chain: derived data in PostgreSQL

`packages/db/src/schema.ts` defines two layers: the on-chain mirror (no prefix), which can be rebuilt by
re-indexing from the deploy block, and the `game_*` tables, which are derived by the published rules. The only
migration is `drizzle/0000_init.sql`. Storage conventions:

- `uint256` values are stored as `numeric(78,0)` strings.
- Times are unix seconds in `bigint` columns.
- Prices, market caps and other derived metrics are `double precision`. They are for display only.

| Group | Table | Key | Contents |
|---|---|---|---|
| **Indexer bookkeeping** | `indexer_state` | `id='main'` | chain id, `last_block` / `last_block_hash` / `last_block_timestamp`, `chain_head`, `game_cursor`, `eth_usd` |
| | `indexed_blocks` | `number` | Hash and timestamp of recent blocks (last 512 kept) for reorg detection |
| | `indexer_errors` | serial | Loop errors and handled reorgs |
| | `excluded_addresses` | `address` | Burn, DEX, protocol and system addresses that can never be citizens |
| **On-chain mirror** | `nations` | `id` | Founding params, curve state (virtual/real reserves, remaining), graduation, pool reserves, emblem |
| | `trades` | `(tx_hash, log_index)` | Curve and Uniswap trades with post-trade price, market cap and liquidity; `venue` |
| | `transfers` | `(tx_hash, log_index)` | Every nation-token `Transfer` |
| | `holders` | `(nation_id, address)` | Current balance and `first_held_at`. Zero balances are deleted |
| | `treasury_txs` | `(tx_hash, log_index)` | Deposits (`trade_fee` / `donation`) and releases |
| | `proposals`, `votes` | `id`; `(proposal_id, voter)` | Governance mirror. Tallies are recomputed from `votes` |
| | `game_action_events` | `proposal_id` | Raw `GameActionExecuted` decrees (the input to the game engine) |
| **Live metrics & stats** | `game_nations` | `nation_id` | Price, market cap, liquidity, 24h volume/trades, 1h/24h change, ATH, treasury, citizens, power scores, tier, territory cells, rank; resources; war wins/losses; alliance; statuses; `last_fired` cooldowns |
| | `game_snapshots` | `(nation_id, epoch)` | One row per nation per hourly epoch (inputs for market events and history charts) |
| **Game engine state** | `game_resource_ledger` | serial, unique `(nation_id, ref)` | Every resource delta, applied exactly once |
| | `game_actions` | `proposal_id` | Decree outcome: `applied` / `rejected` + reason |
| | `game_buildings` | serial, unique `proposal_id` | `constructing` → `complete` |
| | `game_wars` | `id` = DeclareWar proposal id | Start metrics, score breakdown, winner, spoils |
| | `game_alliances`, `game_alliance_members`, `game_alliance_invites` | alliance id = CreateAlliance proposal id | Diplomacy |
| **News & progression** | `game_events` | serial, unique `dedupe_key` | ATLAS NEWS items (type, severity, nation/target, title/body, data) |
| | `game_nation_achievements` | `(nation_id, code)` | Nation achievements |
| | `game_citizen_achievements` | `(address, code)` | Citizen achievements |
| | `game_citizen_xp` | `(address, ref)` | XP awards (each `ref` once) |

Values computed **at read time** in the web app rather than stored:

- Proposal state: mirrors `AtlasGovernor.state()`, using `indexer_state.last_block_timestamp` as "chain now".
- Candles: bucketed from `trades`.
- Citizen XP totals: earned XP plus 5 XP per citizenship-day, capped at 30 days per nation. This uses wall-clock time.
- Citizen leaderboard rank.
- Holder labels and citizen flags.

### 3.3 Determinism and rebuilds

- **Mirror tables** are a pure decode of chain logs. All inserts are `ON CONFLICT DO NOTHING`, so a range can be
  applied twice without effect.
- **Engine-derived state is replayable.** Setting `game_cursor = 0` makes the engine call `reset()` and replay
  from the first nation's `createdAt − 1`. Both a reorg and `pnpm --filter @atlaspad/indexer rebuild-game`
  (`src/rebuild.ts`) do this. `reset()` does the following:
  - Truncates `game_snapshots`, `game_resource_ledger`, `game_actions`, `game_buildings`, `game_wars` and the
    alliance tables.
  - Deletes `game_events` whose `dedupe_key LIKE 'g:%'`.
  - Zeroes resources, war counters, alliance, statuses and `last_fired` in `game_nations`.

  The integration test checks that a replay produces the same digest of these tables.
- **What `reset()` leaves untouched.** Achievements, XP and non-`g:` news are produced during forward sync
  (`sync/post.ts`, `sync/metrics.ts`). They are idempotent through their keys, but `rebuild-game` does not
  recreate or clear them. Only a full re-index of the mirror regenerates them.
- **Wall-clock inputs.** `eth_usd` is a live price. It feeds the `game_snapshots.eth_usd` column and the
  `MCAP_1M_USD` achievement, so those values depend on when they were computed. Everything else uses block
  timestamps.

---

## 4. Indexer (`apps/indexer`)

### 4.1 Process (`src/main.ts`, `src/context.ts`, `src/env.ts`)

1. Load the environment.
2. Run Drizzle migrations unless `INDEXER_RUN_MIGRATIONS=false`.
3. Open a postgres.js pool (max 10).
4. Create a viem public client (HTTP, JSON-RPC batch 50, 3 retries).
5. Start the HTTP server.
6. If contracts are not configured, log a warning and serve only `/health`.
7. Otherwise create `ChainSync` and `GameEngine` and run the main loop:
   ```
   loop: caughtUp = sync.step(); engine.step();
         error → log, INSERT indexer_errors(scope='loop'), backoff ×2 up to 60 s
         if caughtUp: sleep INDEXER_POLL_MS (default 2000)
   ```
8. Refresh ETH/USD at startup and every 60 s.

| Env var | Default | Meaning |
|---|---|---|
| `ATLAS_NETWORK` | `robinhood` | `robinhood` or `local` |
| `ATLAS_RPC_URL` | chain default RPC | JSON-RPC endpoint |
| `ATLAS_LAUNCHPAD` / `ATLAS_GOVERNOR` / `ATLAS_TREASURY` | — | All three are required to index |
| `ATLAS_DEPLOY_BLOCK` | `0` | First block to index |
| `ATLAS_UNISWAP_V2_FACTORY` / `_ROUTER` / `ATLAS_WETH` | — | Required only for `local` |
| `DATABASE_URL`, `DATABASE_SSL` | — | Postgres |
| `PORT` / `INDEXER_PORT` | `4100` | HTTP server |
| `INDEXER_CONFIRMATIONS` | `2` | Blocks behind head |
| `INDEXER_BATCH_BLOCKS` | `2000` | Max getLogs range |
| `INDEXER_POLL_MS` | `2000` (min 250) | Idle poll interval |
| `INDEXER_ADMIN_TOKEN` | unset | Enables `/admin/status` |
| `INDEXER_CORS_ORIGIN` | `*` | CORS for all endpoints |
| `ETH_USD_SOURCE` | `none` | `coinbase` or `none` |
| `EXCLUDED_ADDRESSES` | — | `addr[:label],…`: extra non-citizen addresses |
| `LOG_LEVEL`, `MIGRATIONS_DIR` | `info`, auto | Logging (JSON lines), migrations folder override |

### 4.2 Sync pipeline (`src/sync/*.ts`)

```
step():
  init (once)  → upsert indexer_state (last_block = deployBlock-1), assert DB chain_id and RPC chainId,
                 seed excluded_addresses, load NationCache from `nations`
  head         → getBlockNumber; store chain_head; target = head - INDEXER_CONFIRMATIONS
  reorg check  → getBlock(last_block).hash ≠ stored last_block_hash ? handleReorg()
  range        → [last_block+1, min(target, last_block+batch)]
  fetchBatch   → decoded, ordered events + block hashes/timestamps
  applyBatch   → one DB transaction (mirror rows + cursor)
  postProcess  → after commit: news, XP, achievements, metrics, ranks, realtime publish
```

**Fetch (`fetch.ts`)**

- One `getLogs` covers the launchpad, governor and treasury.
- Token and pair addresses founded or graduated inside the range are discovered from that range's
  `NationFounded` / `NationGraduated` logs.
- `Transfer` logs are fetched for all nation tokens, and all logs for graduated pairs. Addresses are chunked by
  250, with 8 concurrent requests.
- `getBlock` is called for every block that has logs, plus the range end (hash and timestamp).
- For Uniswap `Swap` logs, `getTransaction` attributes the trade to the transaction sender.
- Events are sorted by `(blockNumber, logIndex)`.
- RPC "range too large" style errors halve the batch size (minimum 10). The size doubles back after each
  successful step.

**Apply (`apply.ts`)**

- Holder rows are preloaded for addresses touched in the range.
- **Pass 1** registers `NationFounded` and `CurveInitialized`. A token's mint `Transfer` is emitted inside its
  constructor, before the launchpad's founding logs, so the nation must be known before transfers are applied.
- **Pass 2** applies everything else in log order:

| Source | Handling |
|---|---|
| Launchpad `Trade` | Curve state is taken from the event args. Price = `virtualEth / virtualTokens`, market cap = price × supply, liquidity = `realEth`. A trade row is written with `venue = 'curve'` and the fee |
| `NationGraduated` | Sets graduated, zeroes curve ETH, seeds pool reserves from the event |
| `NationSymbolUpdated` | Emblem and metadata URI |
| Treasury `Deposited` / `Released` | `treasury_txs` (`trade_fee` / `donation` / `release`) |
| Governor events | `proposals`, `votes` (tallies recomputed), canceled/executed flags, `game_action_events` |
| Token `Transfer` | Appended to `transfers`. Holder balances are updated in memory; `first_held_at` resets when a balance goes from 0 to positive. A **new citizen** is a non-excluded address whose balance crosses `totalSupply / 1,000,000` (0.0001%) |
| Pair `Sync` / `Swap` | Ignored until the nation has graduated. `Sync` updates reserves. `Swap` produces a `venue = 'uniswap'` trade (fee recorded as 0). The pre-swap market cap is derived from reserves for whale detection only and is not stored |

The transaction writes the nation upserts, all mirror rows, holder upserts and deletes, `indexed_blocks`
(pruned to the last 512) and the `indexer_state` cursor.

Non-citizen exclusions:

- the zero address and `0x…dEaD`
- the Uniswap V2 router and factory, and WETH
- the AtlasPad launchpad, treasury and governor
- known Uniswap router/Permit2/UniswapX contracts on Robinhood Chain (`context.ts`)
- `EXCLUDED_ADDRESSES`
- each nation's own pair

**Post-commit (`post.ts`, `metrics.ts`)**

- **News, XP and achievements:**
  - Founded: news, `NATION_FOUNDED` achievement, founder XP and `FOUNDER` achievement.
  - Graduated: news and `GRADUATED` achievement.
  - Whale buys: `isWhaleBuy` with a per-nation cooldown stored in `game_nations.last_fired`.
  - Proposal created: news, XP and `FIRST_PROPOSAL`.
  - Vote: XP and `FIRST_VOTE`.
  - Proposal executed: XP for the proposer, plus `SYMBOL_CHANGED` news for Symbol proposals.
  - Treasury release: news.
  - New citizen: XP, `FIRST_CITIZENSHIP`, `EARLY_SETTLER` (within 24 h of founding), and `WORLD_CITIZEN` once the
    address holds 5 or more citizenships.
- **`refreshNationMetrics(ids, now)`** recomputes `game_nations` for each affected nation, with `now` = timestamp
  of the latest indexed block:
  - price (curve reserves, or pool reserves after graduation), market cap, liquidity
  - 24 h volume and trade count
  - 1 h and 24 h change, against the last trade before the window or else the curve's opening price
  - ATH, treasury balance, citizen count, citizens 24 h ago (from snapshots)
  - `computeStats` scores, tier and territory
  - citizen and market-cap milestone news and achievements
- **`recomputeRanks`** orders nations by civilization score, then market cap, then id, and returns the rank
  changes.
- **Realtime publish:** `trade`, `nation` (fresh `NationSummary`), `ranks` and `news`. Publishing happens after
  all writes.

### 4.3 Reorg handling (`ChainSync.handleReorg`)

**Detection.** At the start of each step, the stored hash of `last_block` is compared with the chain. Combined
with `INDEXER_CONFIRMATIONS`, this catches reorgs that reach indexed blocks.

**Rewind.**

1. Walk back through up to 512 stored `indexed_blocks` to find the newest block whose hash still matches. That
   block is the fork point.
2. In one transaction:
   - delete rows with `block_number > fork` from `trades`, `transfers`, `treasury_txs`, `votes`,
     `game_action_events` and `game_events`, plus proposals and nations created after the fork, plus
     `indexed_blocks` after the fork
   - rebuild `holders` from the remaining `transfers`
   - recompute vote tallies
   - set `last_block = fork` and `game_cursor = 0`
3. Re-read each surviving nation's curve and pool state at the fork block (`getNation`, `getReserves`) and each
   proposal's executed/canceled flags (`getProposal`). These calls use `blockNumber`, so the RPC must serve
   historical state.
4. Record the reorg in `indexer_errors`.

The game engine then replays from scratch.

### 4.4 ETH/USD price (`src/price.ts`)

With `ETH_USD_SOURCE=coinbase`, the indexer fetches `https://api.coinbase.com/v2/prices/ETH-USD/spot` every 60 s
(8 s timeout) into `indexer_state.eth_usd`. With `none` (the default), USD stays `null` and the UI shows ETH
values with "—" for USD. On-chain values are always ETH.

### 4.5 Game engine (`src/game/*`)

| File | Role |
|---|---|
| `engine.ts` | `GameEngine.step()`: time-ordered scheduler, cursor, replay/reset |
| `epoch.ts` | `tickEpoch(E)`: per-nation snapshot as of E, market events and statuses, hourly resource production, time-based achievements |
| `actions.ts` | `applyAction`: validates a decree against shared rules and applies it (Build, DeclareWar, CreateAlliance, InviteToAlliance, JoinAlliance, LeaveAlliance), or records it as rejected |
| `timed.ts` | Building completions and war endings (war scoring via `resolveWar`, spoils, territory bonus) |
| `state.ts` | Loads game state for stats, `ensureGameRows`, `recomputeRanks` |
| `queries.ts` | Point-in-time reads from the mirror: `citizenCountAsOf` (from transfer history), `lastTradeAsOf`, `volumeBetween`, `forVoters` |
| `common.ts`, `news.ts`, `progress.ts` | `applyResources` (ledger + balances, once per `ref`), `createEvent` (insert-once by `dedupe_key`), XP and achievement helpers |

**Clock.** `safe = last_block_timestamp − 1`. Arbitrum produces several blocks per second that share a
timestamp, so only seconds strictly before the newest indexed block are known to be complete.

**Cursor.** `indexer_state.game_cursor` (unix seconds). Each step processes `(cursor, end]`, where
`end = min(safe, cursor's epoch + 24 epochs)` (`MAX_EPOCHS_PER_STEP = 24`), so catch-up never starves the
chain sync.

**Ordering.** Three event streams are merged by time:

1. timed items (building `completes_at`, war `ends_at`)
2. decrees (`game_action_events` ordered by `timestamp, block_number, log_index`)
3. epoch boundaries (`EPOCH_SECONDS = 3600`)

At equal timestamps the order is completions, then decrees, then the epoch tick.

**Exactly-once.** Every write is keyed:

| Item | Key |
|---|---|
| Engine news | `g:mkt:<TYPE>:<nation>:<E>`, `g:action:<pid>`, `g:build:<pid>`, `g:built:<pid>`, `g:war:<pid>`, `g:warend:<id>`, `g:alliance:<pid>`, `g:invite:<pid>`, `g:join:<pid>`, `g:leave:<pid>` |
| Forward-sync news | `found:<id>`, `graduated:<id>`, `whale:<tx>:<log>`, `proposal:<id>`, `symbol:<id>`, `release:<tx>:<log>`, `citizens:<id>:<m>`, `mcap:<id>:<m>`, `nation-ach:<id>:<code>` |
| Resources | ledger unique `(nation_id, ref)`; refs `epoch:<E>`, `build:<pid>`, `war:<id>:spoils`, `war:<id>:loss` |
| Decrees / buildings / wars / alliances | primary or unique key = proposal id |
| XP / achievements | `(address, ref)`, `(address, code)`, `(nation_id, code)` |

### 4.6 Why timestamps, not `block.number`

`NationToken` overrides the ERC-6372 clock to `block.timestamp` (`CLOCK_MODE = "mode=timestamp"`). The code
comment gives the reason: on an Arbitrum Orbit chain, `block.number` tracks the parent chain. `AtlasGovernor`
snapshots voting power one second before a proposal is created. Proposal `snapshot`, `voteEnd` and `eta` are
unix seconds.

Off-chain, everything time-based uses block timestamps:

- trade and transfer times
- epochs
- 1 h / 24 h windows
- war and building timers
- the web's proposal-state calculation

Block numbers are used only for log ordering and reorg bookkeeping.

### 4.7 HTTP server and realtime (`src/realtime/{bus,server}.ts`)

`RealtimeBus` is an in-process `EventEmitter`. There is no external broker, so realtime fan-out is
single-process.

| Endpoint | Auth | Response |
|---|---|---|
| `GET /health` | public | `{ok, chainId, deployed, lastIndexedBlock, chainHeadBlock, lagBlocks, lastSyncAt, subscribers}` |
| `GET /stream` | public | Server-Sent Events. Starts with `retry: 3000`. Each message is `id: <per-connection seq>` + `data: <RealtimeMessage JSON>`. A `heartbeat` (last indexed block) is sent every 15 s per client. Returns 503 above 5,000 clients |
| `GET /admin/status` | `Authorization: Bearer $INDEXER_ADMIN_TOKEN` (timing-safe compare). 404 when the token is unset, 401 when wrong | Read-only: network config (RPC credentials masked), RPC head/latency, DB counts/latency, indexer stats, last 10 indexed blocks, last 25 errors |
| `OPTIONS *` | — | 204 with CORS headers |
| other | — | 405 (non-GET) / 404 |

Messages the indexer publishes: `trade`, `nation`, `ranks`, `news` (plus server `heartbeat`). The stream has no
replay: a client that reconnects does not receive messages it missed.

---

## 5. Web app (`apps/web`)

### 5.1 Rendering and data flow

- Every page component is a client component (`"use client"`). Pages read data with React Query hooks
  (`src/lib/api.ts`) that call the app's own `/api/*` route handlers.
- Route handlers read Postgres through `src/lib/server/*`:
  - `db.ts`: a shared `server-only` postgres.js pool, `DATABASE_POOL_MAX` (default 3), `prepare: false` for
    transaction-mode poolers.
  - `http.ts`: JSON helpers.
  - `queries.ts`: plus shared readers from `@atlaspad/db/queries`.
- The only other server-side DB read is `generateMetadata` in `app/nation/[id]/layout.tsx`.
- The root layout mounts `Providers` (Wagmi + React Query + realtime bridge), `WorldStage`, `TopNav`,
  `StatusBanner`, `CinematicLayer`, `WalletModal`, `SearchPalette` and `Toaster`.
- UI state (map filter, hover/selection, intro/sound/cinematics preferences, realtime status) lives in a
  zustand store. Part of it is persisted to `localStorage` under `atlaspad-ui`.

| Page | Content |
|---|---|
| `/` | Landing over the rotating globe, world stats, news ticker |
| `/world` | Interactive hex map, filters/search, hover cards, news feed |
| `/discover` | "Nations on the move": discovery lists built from `/api/world` and notable news |
| `/found` | Multi-step founding wizard (live name/ticker availability, curve preview, launch) |
| `/nation/[id]` | Header, capital view, trade panel, tabs: Overview, Economy, Citizens, Government, Infrastructure, Military, Diplomacy, History, Treasury |
| `/news` | ATLAS NEWS feed |
| `/leaderboard` | Nation and citizen rankings |
| `/my-nations`, `/profile`, `/citizen/[address]` | Wallet-scoped citizenships and profile, public profile |
| `/war/[id]`, `/alliance/[id]` | War and alliance detail |
| `/admin` | Operations dashboard (protected, see 5.3) |

| API route | Source | Cache (`s-maxage`) |
|---|---|---|
| `GET /api/world` | `nationSummaries`, `warSummaries`, `allianceSummaries`, `indexerHealth` | 2 s |
| `GET /api/nations/[id]` | nation + buildings, achievements, wars, alliance, invites, resource ledger, holder count, curve | 2 s |
| `GET /api/nations/[id]/candles?interval=` | `trades` bucketed (60/300/900/3600/14400/86400 s) | 2 s |
| `GET /api/nations/[id]/series?days=` | `game_snapshots` | 30 s |
| `GET /api/nations/[id]/trades`, `/holders`, `/proposals`, `/treasury` | mirror tables | 2–5 s |
| `GET /api/proposals/[id]` | proposal + votes | 2 s |
| `GET /api/news?before=&nation=&severity=&limit=` | `game_events` | 2 s |
| `GET /api/wars/[id]`, `/api/alliances/[id]` | game tables | 2 s / 5 s |
| `GET /api/citizens/[address]`, `/api/leaderboard/citizens` | XP, holdings, achievements, votes | 5 s / 10 s |
| `GET /api/search-index` | nation and alliance names | 15 s |
| `GET /api/status` | deployment + DB + indexer health (no-store) | — |
| `GET /api/admin/status` | admin only (no-store) | — |

`withDb()` returns `503 {error: "data_unavailable", reason}` when `DATABASE_URL` is missing or a query throws.
It never returns fabricated data. Cached responses send
`Cache-Control: public, s-maxage=N, stale-while-revalidate=4N`.

### 5.2 Realtime bridge (`src/lib/realtime.ts`) and effects (`src/lib/effects.ts`)

`useRealtimeBridge()` opens an `EventSource` to `${NEXT_PUBLIC_REALTIME_URL}/stream`.

- If the URL is empty, the status is `disabled`.
- On error it closes the connection and reconnects with exponential backoff (2ⁿ s, capped at 30 s).
- Status values are `connecting`, `live`, `offline` and `disabled`.
- While the status is not `live`, hooks fall back to polling (`usePoll`: world/news 30 s, nation 20 s, …).

| Message | Cache updates | Side effects |
|---|---|---|
| `nation` | replace in `["world"]` and `["nation", id]` | — |
| `ranks` | patch `rank` / `previousRank` in `["world"]` | — |
| `trade` | prepend to `["trades", id]` (dedupe by tx + log, cap 100); invalidate `["candles", id]` | `effects.emit({kind:"trade"})` |
| `news` | prepend into matching `["news", nation, severity]` lists (cap 200). For structural types (wars, alliances, buildings, founding), invalidate `["world"]` and the nations involved. Always invalidate that nation's proposals | If newer than 15 min: cinematic for `GOLDEN_AGE`, `ECONOMIC_CRISIS`, `WAR_DECLARED`, `WAR_ENDED`; sound cues |
| `proposal` | invalidate `["proposals", nationId]` (handled, but the indexer never publishes it) | — |
| `heartbeat` | store last block | — |

`effects` is a module-level listener set (`trade`, `cinematic`, `burst`, `focus`, and `founding-preview`, which
is declared but not emitted). It lets realtime data drive the WebGL scene without re-rendering React.

Consumers:

- `Particles`: trade bursts
- `NationFx`: trade pulses into the data texture
- `CameraDirector`: `focus` fly-to, and the cinematic queue
- `CinematicLayer`: compact banner outside `/world`

### 5.3 Admin protection

`src/proxy.ts` is the Next 16 proxy. Its matcher is `/admin`, `/admin/:path*` and `/api/admin/:path*`.

- It returns **404** unless `ADMIN_USERNAME` and `ADMIN_PASSWORD` are set and the password has at least 12
  characters.
- Otherwise it requires HTTP Basic credentials (`src/lib/admin-auth.ts`, constant-time compare). Missing or
  wrong credentials get **401** with `WWW-Authenticate`.
- Responses get `Cache-Control: no-store` and `X-Robots-Tag: noindex`.

`/api/admin/status` re-checks auth itself. It then aggregates:

- RPC head and chainId (`ATLAS_RPC_URL`, or the public RPC)
- DB counts, errors and blocks
- the indexer's `/admin/status`, fetched via `INDEXER_URL` + `INDEXER_ADMIN_TOKEN`

The dashboard polls every 10 s and is read-only.

### 5.4 Configuration and "unavailable" states

`src/lib/env.ts` reads the `NEXT_PUBLIC_*` variables by literal name, because Next inlines them at build time.
It passes them to `resolveNetwork()` (`packages/shared/src/config.ts`):

- `contracts` is non-null only when all three addresses are valid.
- `local` additionally requires the DEX addresses.
- On a `ConfigError`, the app falls back to Robinhood Chain without contracts and exposes `configError`.
- `isDeployed = contracts !== null && configError === null`.

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_ATLAS_NETWORK`, `NEXT_PUBLIC_RPC_URL` | Chain selection, wagmi transport |
| `NEXT_PUBLIC_ATLAS_LAUNCHPAD` / `_GOVERNOR` / `_TREASURY` / `_DEPLOY_BLOCK` | Contract addresses |
| `NEXT_PUBLIC_ATLAS_UNISWAP_V2_FACTORY` / `_ROUTER` / `NEXT_PUBLIC_ATLAS_WETH` | Local network only |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Enables the WalletConnect connector |
| `NEXT_PUBLIC_REALTIME_URL` | Indexer base URL for SSE |
| `NEXT_PUBLIC_SITE_URL` | Metadata / wallet metadata |
| `DATABASE_URL`, `DATABASE_SSL`, `DATABASE_POOL_MAX` | Server-side read pool |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `INDEXER_URL`, `INDEXER_ADMIN_TOKEN`, `ATLAS_RPC_URL` | Admin dashboard |

| Condition | Behavior |
|---|---|
| Wallet on another chain | `StatusBanner` offers `switchChain`. `useAtlasTx` switches before sending |
| `configError` | Warning banner. On-chain actions disabled |
| Contracts not configured | Info banner ("not yet deployed"). `TradePanel` shows "Trading is unavailable". Contract reads are gated by `enabled: Boolean(contracts)` |
| No DB / DB failing | `/api/*` returns 503. Components render `DataUnavailable`. Banner: "Live world data is unavailable" |
| No `NEXT_PUBLIC_REALTIME_URL` / SSE down | Realtime `disabled` / `offline`. React Query polling fallback |
| No WebGL | `WorldStage` renders a gradient and a text fallback |
| `ETH_USD_SOURCE=none` | `ethUsd: null`. USD shown as "—" |
| Indexer without contracts | Serves `/health` only (`deployed: false`) |

`contracts/deployments/` currently contains only the local `31337.json` (gitignored, regenerated by
`DeployLocal`). There is no recorded Robinhood deployment in the repo.

### 5.5 Wallets (`src/lib/wagmi.ts`, `components/wallet/WalletModal.tsx`)

- `createConfig` takes a single chain (`network.chain`) and an `http(network.rpcUrl)` transport, with
  `ssr: true`.
- Connectors:
  - `injected({ shimDisconnect: true })` with `multiInjectedProviderDiscovery: true` (EIP-6963)
  - `walletConnect` (with QR modal), only when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set
  - `coinbaseWallet` (telemetry off)
- The modal lists EIP-6963-discovered wallets and hides the generic injected entry when specific wallets exist.

### 5.6 Transaction lifecycle (`src/lib/tx.ts`, `components/tx/TxDialog.tsx`)

```
TxDialog open ─► reset ─► prepare(previewCall): simulateContract + estimateGas × getGasPrice
                            ├─ ok   → fee shown, Confirm enabled
                            └─ fail → phase "failed" (friendly error, "Try again")
Confirm ─► [buildCall? sign EIP-712 permit (awaiting_signature) → prepare(call)]
        ─► ensure chain (switchChain) ─► awaiting_wallet ─► writeContract
        ─► submitted ─► confirming ─► waitForTransactionReceipt (timeout 180 s)
              receipt.status === "success" → confirmed (success view, explorer link, onConfirmed)
              reverted → failed · timeout → "Still pending" · user reject → rejected
```

- Nothing is shown as successful before a successful receipt.
- The dialog cannot be dismissed while a transaction is in flight.
- Irreversible actions can require an acknowledgment checkbox.
- `onConfirmed` callers invalidate the relevant React Query keys (nation, world, proposals).
- The founding wizard (`/found`) uses `useAtlasTx` directly and decodes `NationFounded` from the receipt to get
  the new id.

Trading (`components/nation/TradePanel.tsx`):

- **Before graduation** it uses the launchpad curve: `quoteBuy` / `quoteSell` / `spotPrice`, then `buy`,
  `sell`, or `sellWithPermit` (EIP-2612 signature instead of an approval).
- **After graduation** it uses the Uniswap V2 router: `getAmountsOut`, then `swapExactETHForTokens`, or
  `approve` + `swapExactTokensForETH`.
- Default slippage is 1% on the curve and 2% on Uniswap. Deadline is 20 min.

Error mapping (`src/lib/errors.ts`):

- `UserRejectedRequestError` → "Request rejected".
- `ContractFunctionRevertedError` → plain-language text from `CONTRACT_ERRORS`, keyed by the contract's custom
  error name (for example `NameTaken`, `Slippage`). `apps/web/test/errors.test.ts` checks this map against
  the generated ABIs.
- Heuristics for insufficient funds, chain mismatch and nonce errors.
- A generic fallback.
- The technical message is kept for the "Technical details" toggle.

---

## 6. World renderer (`apps/web/src/components/world/*`)

| File | Role |
|---|---|
| `WorldStage.tsx` | Persistent `<Canvas>` from the root layout. Active on `/` (`hero`: rotating globe, no pointer events) and `/world` (`map`); renders nothing elsewhere. WebGL detection with fallback. Builds the model, the highlight map and the DOM label overlay |
| `model.ts` | `buildWorldModel(nations, wars, alliances)`: shared `generateWorld` + `layoutWorld`, then per-cell, light, structure and route attribute arrays. Uniforms. Analytic cell picking (`cellFromPlane` / `cellFromSphere`) |
| `shaders.ts` | GLSL. `MORPH_CHUNK` places every vertex from both a plane position and lon/lat, blended by `uMorph` (0 = globe, 1 = map) |
| `layers.tsx` | `OceanLayer`, `HexLayer`, `StructuresLayer`, `LightsLayer`, `RoutesLayer`, `Atmosphere`, `Stars` |
| `WorldScene.tsx` | Scene graph, `Particles`, `NationFx` (data texture writer), `CameraDirector` (GSAP), `LabelProjector`, picking plane |
| `highlight.ts` | Per-nation emphasis factor for map filters/search (dims, never hides) |

**Model rebuild.** `buildWorldModel` reruns only when a `shapeKey` changes. The key covers: nation ids,
territory cells, tier, emblem, building count, rank, log₂ citizens, active war ids and alliance memberships.
Live per-nation values (statuses, pulses, highlight) go through the data texture.

**Hex cells.** A single `InstancedBufferGeometry` uses a 6-segment `CircleGeometry` as the base, with
`instanceCount = 20,000`, all in one draw call. Per-instance attributes: `aPlane`, `aLonLat`, `aColor`, `aLift`,
`aGlow`, `aRevealAt`, `aNationIdx`, `aBorder`. The geometry is allocated once; on model change the arrays are
overwritten in place.

**Globe ↔ map morph.** Positions and normals are computed on the GPU. GSAP tweens `uMorph`, along with `uReveal`
(reveal sweep by rank), `uRouteOpacity` and `uAtmosphere`.

**Nation data texture.** `uNationTex` is a 4096 × 1 RGBA float `DataTexture`, indexed by `aNationIdx` (index
1…4095, clamped). Each frame, `NationFx` writes:

| Channel | Value |
|---|---|
| R | Trade pulse (decays over time) |
| G | Buy vs sell |
| B | Status code (+0.5 while at war), refreshed every second |
| A | Highlight (filter/hover/selection) |

**Other layers.**

- `StructuresLayer`: instanced boxes forming the capital skyline, plus the Spaceport tower.
- `LightsLayer`: points for city lights. Density scales with tier, citizens and buildings.
- `RoutesLayer`: line segments, 48 per route. Alliance routes (gold) run leader → member; active wars are red.
- `Particles`: 1,600-slot ring buffer, additive points, driven by `trade` and `burst` effects.
- `Stars`: 2,600 points.
- `Atmosphere`: globe mode only.

**Bloom.** `EffectComposer` + `Bloom` (mipmap blur), desktop only.

**Camera director.** GSAP timelines handle three intro kinds:

- `full`: fly in from space with the reveal sweep.
- `short`: morph between globe and map.
- `none`: snap to the pose.

`mapPose()` fits the map to the viewport. A window event `atlas:skip-intro` jumps to the end of the timeline.
`gsap.ticker.lagSmoothing(0)` keeps intros in wall-clock time on slow GPUs. `MapControls` keeps distance
between 3 and 34, disables rotation on mobile and clamps the target to the map bounds. A `focus` effect flies
to a capital.

**Event cinematics.** Cinematics are queued. One plays only when all of these hold:

- the map is active and cinematics are enabled
- the user has been idle for at least 4 s
- at least 30 s have passed since the last cinematic

The camera flies to the capital (or the midpoint of two capitals), triggers a `burst` at 1.4 s and returns at
5.4 s. Off the map, only the burst plays, and `CinematicLayer` shows a compact banner.

**Labels.** A DOM overlay of buttons covers the top-ranked nations: 36 on desktop, 10 on mobile. `LabelProjector`
projects their capitals every frame and writes `style.transform` and `opacity` directly, with no React
re-render.

**Picking.** In map mode, an invisible plane mesh receives pointer events. The hit point is converted to a cell
by hex math, then to a nation via `layout.owner`; there is no per-instance raycasting. Coarse pointers select
instead of navigating.

**Performance choices.**

| Choice | Effect |
|---|---|
| Instancing (hexes, structures) and point sprites (lights, stars, particles) | Few draw calls |
| GPU morph | No CPU re-layout between globe and map |
| Data texture for live per-nation values | No geometry rebuild on trades or status changes |
| `shapeKey`-gated model rebuild | Model rebuilt only when the world's shape changes |
| DPR caps | `[1, 1.5]` mobile / `[1, 2]` desktop |
| Bloom | Disabled on mobile |
| Labels | Capped |

There is **no LOD and no frustum culling**. Every layer sets `frustumCulled={false}`, because final positions
are computed in the shaders, so all 20,000 cells are always drawn.

---

## 7. Testing

| Layer | Location | Command | Requires |
|---|---|---|---|
| Contracts | `contracts/test`: `AtlasLaunchpad`, `AtlasGovernor`, `NationToken`, `NationTreasury`, `Invariants` (handler-based), `Base`, `mocks/` (Uniswap V2 port, WETH9) | `pnpm contracts:test` (`forge test -vv`). Fuzz runs: 512 default, 4096 with `FOUNDRY_PROFILE=ci` | Foundry + submodules |
| Shared unit | `packages/shared/test`: `curve.test.ts` (bigint curve port), `game.test.ts` (stats, market events, rules, emblem), `world.test.ts` (deterministic terrain, wrap, stable capitals, territory size) | `pnpm --filter @atlaspad/shared test` (vitest) | — |
| Web unit | `apps/web/test`: `admin-auth.test.ts` (Basic-auth gate), `errors.test.ts` (error map vs ABIs, revert/rejection mapping). `vitest.config.ts` includes `test/**/*.test.ts` and aliases `@` | `pnpm --filter @atlaspad/web test` (vitest) | — |
| Indexer integration | `apps/indexer/test/integration.test.ts` + `scenario.ts` | `INTEGRATION=1 TEST_DATABASE_URL=postgresql://…/atlaspad_test pnpm --filter @atlaspad/indexer test` (skipped without `INTEGRATION=1`) | `anvil`, `forge`, Postgres (the test DB is dropped and recreated) |
| Browser E2E | `apps/web/e2e/flows.e2e.mjs` + `e2e/wallet.js` | `pnpm e2e` (optional args: base URL, screenshot dir) | Running local stack (`scripts/dev-local.sh`), Chromium at `CHROMIUM_PATH` |
| DB package | — | `test` script only echoes "covered by indexer integration tests" | — |

**Indexer integration test.**

- Spawns anvil on port 8547 with a fixed timestamp and deploys with `script/DeployLocal.s.sol`.
- Sends a scripted set of real transactions: founding, curve trades, graduation, Uniswap swaps, transfers,
  proposals, votes and execution.
- Runs `ChainSync` + `GameEngine` until caught up, with `INDEXER_CONFIRMATIONS=0` and batch size 40.
- Asserts:
  - nations, curve state and graduation
  - holder balances equal on-chain `balanceOf` and sum to total supply
  - curve and Uniswap trade counts
  - executed proposals and applied decrees (completed building, ended war, alliance members, treasury release)
  - news types
  - snapshot and XP counts
  - that a game replay (`game_cursor = 0`) reproduces an identical digest

**Browser E2E.**

- `playwright-core` drives Chromium with SwiftShader WebGL.
- `wallet.js` injects an EIP-1193 provider announced over EIP-6963 that forwards requests to anvil (account
  #9).
- Steps:
  1. Open the wizard and connect the wallet.
  2. Check name and ticker availability, then fill the description, theme, symbol and token parameters.
  3. Simulate and found a nation.
  4. Open the indexed nation.
  5. Buy on the curve, then sell 50% with a permit.
  6. Propose a Capitol.
  7. Wait for the proposal to appear via the indexer.
  8. Check the nation appears on the world map.
- Screenshots go to `e2e/screenshots/`, which is gitignored.

**Local stack (`scripts/dev-local.sh`).**

1. Starts anvil on port 8545 if none is running (genesis timestamp 7 days in the past).
2. Drops and recreates the `public` and `drizzle` schemas.
3. Runs `apps/indexer/scripts/seed-local.ts`. This refuses any chain other than 31337, deploys with
   `DeployLocal.s.sol`, runs the scenario plus extra nations, and writes `apps/indexer/.env.local` and
   `apps/web/.env.local`.
4. Starts the indexer (port 4100) and `next dev` (port 3000) in the background. Logs go to
   `/tmp/atlaspad-dev`.
