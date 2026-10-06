# AtlasPad

**Every token is a nation. Every holder is a citizen. The market shapes the world.**

AtlasPad is an on-chain civilization game and token launchpad for **Robinhood Chain** (Arbitrum Orbit L2, chain id `4663`, gas paid in ETH). Founding a nation deploys a real ERC-20 token that trades on a bonding curve and graduates to a Uniswap V2 pool. Holders are the nation's citizens: they vote on what it builds, which wars it declares and which alliances it joins, and how its treasury is spent. A deterministic game engine turns on-chain activity into territory, buildings, resources, wars, golden ages and crises on a living world map.

> **Status.** All code in this repository is implemented and tested locally (Foundry unit tests, indexer integration tests on anvil + Postgres, and browser end-to-end flows). **The contracts have not been deployed to Robinhood Chain mainnet yet** — the development sandbox could not reach the mainnet RPC. Until an operator deploys them and configures the addresses (see [DEPLOYMENT.md](DEPLOYMENT.md)), the app shows on-chain actions as unavailable instead of simulating them. The contracts have not been externally audited.

> **Risk.** Nation tokens are volatile, thinly traded crypto assets. Prices can go to zero. Nothing here is financial advice, and AtlasPad never promises returns.

## What's in the box

| Area | What it does |
| --- | --- |
| **Contracts** (`contracts/`) | `AtlasLaunchpad` (founding, bonding-curve buy/sell, graduation to Uniswap V2 with LP burned), `NationToken` (ERC-20 + permit + timestamp-based votes), `NationTreasury` (governance-controlled ETH), `AtlasGovernor` (per-nation token-weighted proposals). No admin keys, no upgradeability. See [CONTRACTS.md](CONTRACTS.md). |
| **Indexer** (`apps/indexer`) | Reads chain logs in batches with reorg handling, tracks holders and citizens, trades, governance and treasury; runs the deterministic game engine; publishes news, XP and achievements; serves a Server-Sent Events stream. |
| **Web app** (`apps/web`) | Next.js app with the 3D world (globe → map), nation pages, founding wizard, trading, governance, leaderboards, news, profiles and a protected admin dashboard. |
| **Shared** (`packages/shared`) | Chain config, ABIs, formatting, and the game rules used by both the indexer and the UI. |
| **Database** (`packages/db`) | Drizzle schema and SQL migrations for PostgreSQL. |

### Pages

`/` landing globe · `/world` interactive map (search, filters, hover cards, live events) · `/discover` · `/found` 8-step founding wizard · `/nation/[id]` (Overview, Economy, Citizens, Government, Infrastructure, Military, Diplomacy, History, Treasury) · `/war/[id]` · `/alliance/[id]` · `/leaderboard` (Overall Civilization, Largest Economy, Most Citizens, Strongest Nation, Fastest Growing, Most Active, Most Developed, Most Influential) · `/news` · `/my-nations` · `/profile` and `/citizen/[address]` · `/admin` (HTTP Basic auth, disabled unless configured).

## Quick start (local chain)

Requirements: Node ≥ 22.9, pnpm 10, [Foundry](https://book.getfoundry.sh/) (`forge`, `anvil`, `cast`), PostgreSQL 16 with a database `atlaspad` owned by `atlas:atlas` (or set `DATABASE_URL`).

```bash
git submodule update --init --recursive   # forge-std + OpenZeppelin
pnpm install
pnpm contracts:test                       # Foundry test suite
pnpm dev:local                            # anvil + deploy + seed + indexer + web
```

`pnpm dev:local` (`scripts/dev-local.sh`) **drops and recreates the `public` schema** of the target database, deploys the contracts to anvil, seeds a small world with real local transactions, writes `apps/indexer/.env.local` and `apps/web/.env.local`, and starts the indexer (`http://localhost:4100/health`) and web app (`http://localhost:3000`). Connect any browser wallet to `http://127.0.0.1:8545` (chain id 31337) with an anvil development account.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm contracts:build` / `pnpm contracts:test` | Build / test the Solidity contracts |
| `pnpm contracts:abi` | Re-export ABIs from Foundry output into `packages/shared` |
| `pnpm typecheck` · `pnpm lint` · `pnpm test` | Typecheck, lint and unit-test every package |
| `INTEGRATION=1 TEST_DATABASE_URL=… pnpm --filter @atlaspad/indexer test` | Indexer integration tests (spawns anvil, uses a separate database) |
| `pnpm e2e` | Browser end-to-end flows against a running local stack |
| `pnpm build` | Production builds (indexer bundle + Next.js) |
| `pnpm db:migrate` | Apply database migrations |

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — components, data flow, on-chain vs. off-chain data
- [CONTRACTS.md](CONTRACTS.md) — contract reference, bonding curve, graduation, governance
- [GAME_MECHANICS.md](GAME_MECHANICS.md) — citizens, stats, buildings, wars, alliances, events, progression
- [DEPLOYMENT.md](DEPLOYMENT.md) — mainnet deployment, verification, smoke test, hosting, local end-to-end
- [ENVIRONMENT.md](ENVIRONMENT.md) and [`.env.example`](.env.example) — every configuration variable
- [SECURITY.md](SECURITY.md) — trust model, protections, known risks, reporting

## Principles the code follows

- **Real data only.** Balances, prices, liquidity, holders and trades come from the chain or the indexer. When data is missing the UI says "Data unavailable".
- **No fake confirmations.** Transactions are simulated first, require explicit wallet confirmation, and are shown as successful only after the receipt confirms.
- **Transparent economics.** Fees, founder allocation and vesting, curve parameters and treasury rules are on-chain constants shown in the UI.
- **No gambling.** Wars are decided by measurable nation metrics, not randomness, and there is nothing to bet on.
- **No admin backdoors.** Contracts have no owner, pause or upgrade path; treasuries move only through governance.
