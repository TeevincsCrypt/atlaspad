# AtlasPad environment reference

This page lists every environment variable the AtlasPad code reads, with its type, its default and its effect. Each entry was checked against the code that reads it. A ready-to-copy catalog is in [`.env.example`](./.env.example), and deployment steps are in [DEPLOYMENT.md](./DEPLOYMENT.md).

Target chain: **Robinhood Chain mainnet**, an Arbitrum Orbit L2 with ETH as the gas token.

| | |
|---|---|
| Chain ID | `4663` |
| RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |

These are defined in `packages/shared/src/chains.ts`.

---

## Where each component loads its environment

| Component | How it starts | Files it loads |
|---|---|---|
| Web (`apps/web`) | `next dev` / `next build` / `next start` | Next.js loads `.env`, `.env.local`, `.env.<NODE_ENV>` and `.env.<NODE_ENV>.local` from **`apps/web/`**, and shell variables win over all of them. It does **not** load the repo-root `.env`. `NEXT_PUBLIC_*` values are inlined into the browser bundle **at build time**. |
| Indexer, dev | `pnpm dev:indexer` → `tsx watch --env-file-if-exists=.env.local --env-file-if-exists=../../.env src/main.ts` | `apps/indexer/.env.local`, then the repo-root `.env`. The later file wins, so **the root `.env` overrides `.env.local`**. Shell variables win over both. |
| Indexer, game rebuild | `pnpm --filter @atlaspad/indexer rebuild-game` → `tsx --env-file-if-exists=../../.env src/rebuild.ts` | Only the repo-root `.env`. It does **not** load `apps/indexer/.env.local`. |
| Indexer, production | `pnpm --filter @atlaspad/indexer start` → `node dist/main.js` | No file. Set real process environment variables (or run `node --env-file=<file> dist/main.js` yourself). |
| `scripts/dev-local.sh` | starts the indexer with `npx tsx --env-file=.env.local src/main.ts` | Only `apps/indexer/.env.local`, which `seed-local.ts` writes. |
| DB migrations | `pnpm db:migrate` → `tsx src/migrate.ts` (in `packages/db`) | No file. Export `DATABASE_URL` in the shell. |
| Contracts | `forge script …` (run from `contracts/`) | The shell environment. Foundry also auto-loads **`contracts/.env`** (the Foundry project root). It does not load the repo-root `.env`. |

> `--env-file-if-exists` is newer than the repo's minimum `node >=20.11`: it was introduced in Node 22.9. If your Node rejects the flag, use Node 22 LTS, or export the variables and run `tsx src/main.ts` directly.

> **Empty is not always "unset".** Most variables treat an empty string as missing. Five do not:
> - `NEXT_PUBLIC_ATLAS_NETWORK` / `ATLAS_NETWORK`: empty raises `Unknown ATLAS network ""`.
> - `NEXT_PUBLIC_SITE_URL`: empty breaks `new URL()` in the root layout.
> - `DATABASE_POOL_MAX`: empty becomes a pool of 0.
> - `ETH_USD_SOURCE`: empty is a startup error.
> - `SMOKE_NAME` / `SMOKE_SYMBOL`: empty becomes an empty string and the founding transaction reverts.
>
> Either give these a real value or leave them out entirely.

---

## How network resolution works (`packages/shared/src/config.ts` → `resolveNetwork`)

The web app (`NEXT_PUBLIC_ATLAS_*`) and the indexer (`ATLAS_*`) both pass their raw values to `resolveNetwork`:

1. **Network key.** It is `"robinhood"` when unset. Anything other than `robinhood` or `local` throws `ConfigError`.
2. **DEX addresses.**
   - `robinhood`: the Uniswap V2 factory, the router and WETH always come from `ROBINHOOD_DEX` in `packages/shared/src/chains.ts`. The `*_UNISWAP_V2_FACTORY`, `*_UNISWAP_V2_ROUTER` and `*_WETH` variables are **ignored**.
   - `local`: all three variables are **required**. Otherwise it throws `Local network requires uniswapV2Factory, uniswapV2Router and weth.`
3. **Contracts.**
   - Each of launchpad, governor and treasury is validated as an address when set. An invalid address throws `ConfigError`.
   - `contracts` is non-null only when **all three** are set. If one or two are missing, the config is silently treated as "not deployed" and no error is raised.
4. **RPC URL.** It is the RPC env var if non-empty, otherwise the chain's default RPC.
5. **Deploy block.** It is `BigInt(deployBlock)` if non-empty, otherwise `0`.

What each component does with the result:

**Web** (`apps/web/src/lib/env.ts`):
- Any error is caught and stored in `configError`. The app then falls back to Robinhood Chain with `contracts = null`.
- `isDeployed = contracts !== null && configError === null`.
- When not deployed, these parts of the UI change:
  - The banner reads "AtlasPad contracts are not yet deployed on Robinhood Chain. Founding, trading and governance are disabled…", or "Configuration error: … On-chain actions are disabled." when there is a config error.
  - `/found` shows "Founding is not available yet".
  - The trade panel shows "Trading is unavailable…".
  - Governance write actions are hidden or disabled.
  - `/api/status` returns `deployed: false`.

**Indexer** (`apps/indexer/src/env.ts`):
- Any config error makes it exit at startup.
- With `contracts = null` it logs `AtlasPad contracts are not configured … Serving health only.` and does not index.
- On first sync it refuses to run in two cases:
  - The RPC chain id differs from the configured network.
  - The database was already indexed for a different chain (`indexer_state.chain_id`).

---

## Web: public build-time variables (`apps/web/src/lib/env.ts`)

Every value below is visible to anyone. Never put a secret in a `NEXT_PUBLIC_*` variable. Values are baked in at `next build`, so **changing them means rebuilding**.

| Variable | Required? | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_ATLAS_NETWORK` | No | `robinhood` (when unset) | `robinhood` or `local`. An empty or unknown value becomes a config error (banner shown, on-chain actions disabled). |
| `NEXT_PUBLIC_RPC_URL` | No | Chain default (`https://rpc.mainnet.chain.robinhood.com`, or `http://127.0.0.1:8545` for local) | RPC for the wagmi transport in the browser. Note the name: it is `NEXT_PUBLIC_RPC_URL`, not `NEXT_PUBLIC_ATLAS_RPC_URL`. |
| `NEXT_PUBLIC_ATLAS_LAUNCHPAD` | For on-chain actions | none | `AtlasLaunchpad` address, from `contracts/deployments/4663.json` `.launchpad`. |
| `NEXT_PUBLIC_ATLAS_GOVERNOR` | For on-chain actions | none | `AtlasGovernor` address (`.governor`). |
| `NEXT_PUBLIC_ATLAS_TREASURY` | For on-chain actions | none | `NationTreasury` address (`.treasury`). |
| `NEXT_PUBLIC_ATLAS_DEPLOY_BLOCK` | No | `0` | Parsed with `BigInt`, and an invalid value is a config error. Nothing in the web app currently uses the parsed value. Keep it equal to `ATLAS_DEPLOY_BLOCK` for consistency. |
| `NEXT_PUBLIC_ATLAS_UNISWAP_V2_FACTORY` | Only for `local` | none | Ignored on `robinhood`. |
| `NEXT_PUBLIC_ATLAS_UNISWAP_V2_ROUTER` | Only for `local` | none | Ignored on `robinhood`. |
| `NEXT_PUBLIC_ATLAS_WETH` | Only for `local` | none | Ignored on `robinhood`. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | No | `""` | WalletConnect Cloud project id. When empty, the WalletConnect connector is omitted. Injected (EIP-6963) wallets and Coinbase Wallet are always offered. |
| `NEXT_PUBLIC_REALTIME_URL` | No | `""` | Public base URL of the indexer HTTP server. The browser opens `EventSource(<url>/stream)`, and a trailing `/` is stripped. When empty, realtime is "disabled" and React Query polls instead (the nav shows "Polling"). |
| `NEXT_PUBLIC_SITE_URL` | No | `https://atlaspad.app` (when unset) | Used for `metadataBase` in `app/layout.tsx` and for the WalletConnect and Coinbase Wallet app metadata (`url`, `icons`). Must be an absolute URL. |

## Web: server-only runtime variables

These are read at request time by route handlers, `src/proxy.ts`, `src/lib/admin-auth.ts` and `src/lib/server/db.ts`.

| Variable | Required? | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | For live data | none | Postgres URL of the indexer database. The web app only runs `SELECT`s. Without it, `getSql()` returns `null`, every data route under `/api/*` answers `503 {"error":"data_unavailable"}`, and `/api/status` reports `database: "not_configured"`. **Secret.** |
| `DATABASE_SSL` | No | off | Only the exact string `true` enables TLS (`ssl: "require"`). |
| `DATABASE_POOL_MAX` | No | `3` | Size of the postgres.js pool per server process. The pool uses `prepare: false`, so it works behind PgBouncer, Neon or Supabase transaction poolers. Not validated: an empty or non-numeric value yields `0` or `NaN`. |
| `ADMIN_USERNAME` | No | none | HTTP Basic user for `/admin`, `/admin/*` and `/api/admin/*`. |
| `ADMIN_PASSWORD` | No | none | HTTP Basic password. The admin area exists **only if** both admin variables are set **and** the password is at least 12 characters. Otherwise those paths return `404`. **Secret.** |
| `INDEXER_URL` | No | none | Indexer base URL as reached **from the web server**; a private address is fine. Used only by `/api/admin/status`, which `GET`s `<INDEXER_URL>/admin/status` with an 8 s timeout. |
| `INDEXER_ADMIN_TOKEN` | No | `""` | Sent as `Authorization: Bearer …` to the indexer's `/admin/status`. Must equal the indexer's `INDEXER_ADMIN_TOKEN`. **Secret.** |
| `ATLAS_RPC_URL` | No | `NEXT_PUBLIC_RPC_URL`, then the chain default | Server-side RPC used only by `/api/admin/status` to read the head block and check the chain id. |

## Indexer (`apps/indexer/src/env.ts`, `log.ts`, `migrate.ts`)

| Variable | Required? | Default | Description |
|---|---|---|---|
| `ATLAS_NETWORK` | No | `robinhood` (when unset) | `robinhood` or `local`. An empty or unknown value means exit at startup. |
| `ATLAS_RPC_URL` | No | Chain default | RPC for indexing (viem HTTP, JSON-RPC batches of 50, 3 retries, 20 s timeout). A dedicated provider is recommended. The indexer's `/admin/status` returns this URL with only the `//user:pass@` part masked; an API key in the path or query is shown. Treat it as a **secret** if it embeds an API key. |
| `ATLAS_LAUNCHPAD` | To index | none | If any of the three contract addresses is missing, the indexer serves `/health`, `/stream` and `/admin/status` but does not index. |
| `ATLAS_GOVERNOR` | To index | none | See `ATLAS_LAUNCHPAD`. |
| `ATLAS_TREASURY` | To index | none | See `ATLAS_LAUNCHPAD`. |
| `ATLAS_DEPLOY_BLOCK` | Strongly recommended | `0` | Decimal block number. On first start against an empty DB, the cursor is initialised to `max(0, ATLAS_DEPLOY_BLOCK - 1)`. Changing it later does not move the stored cursor; it only affects the reorg fallback. An invalid value means exit (`BigInt` `SyntaxError`). |
| `ATLAS_UNISWAP_V2_FACTORY` | Only for `local` | none | Ignored on `robinhood`. |
| `ATLAS_UNISWAP_V2_ROUTER` | Only for `local` | none | Ignored on `robinhood`. |
| `ATLAS_WETH` | Only for `local` | none | Ignored on `robinhood`. |
| `DATABASE_URL` | **Yes** | none | The indexer exits with `DATABASE_URL is required` when it is missing. `migrate.ts` and `rebuild.ts` also need it. **Secret.** |
| `DATABASE_SSL` | No | off | Only `true` enables TLS (`ssl: "require"`). Applies to the main pool (10 connections, fixed) and to migrations. |
| `PORT` | No | (see `INDEXER_PORT`) | HTTP port. Takes precedence over `INDEXER_PORT`. Integer ≥ 0. |
| `INDEXER_PORT` | No | `4100` | HTTP port when `PORT` is unset or empty. Integer ≥ 0. It is validated even when `PORT` is set. |
| `INDEXER_CONFIRMATIONS` | No | `2` | Blocks to lag behind the head. Integer ≥ 0. Reorgs are still detected through stored block hashes. |
| `INDEXER_BATCH_BLOCKS` | No | `2000` | Max blocks per log batch. Integer ≥ 1. Halved automatically (minimum 10) when the RPC rejects a range, then grown back. |
| `INDEXER_POLL_MS` | No | `2000` | Sleep between polls once caught up. Integer ≥ 250. On errors it backs off exponentially up to 60 000 ms. |
| `INDEXER_ADMIN_TOKEN` | No | none | Bearer token for `GET /admin/status`, compared in constant time. When empty, `/admin/status` returns `404`. **Secret.** |
| `INDEXER_CORS_ORIGIN` | No | `*` | Sent verbatim as `Access-Control-Allow-Origin` on every response, including `/stream`. It is a single origin (for example `https://atlaspad.app`) or `*`, not a list. |
| `INDEXER_RUN_MIGRATIONS` | No | on | Runs Drizzle migrations at startup unless the value is exactly `false`. |
| `MIGRATIONS_DIR` | No | auto | Folder containing `meta/_journal.json`. If unset, the indexer searches in order: `<module dir>/drizzle` (that is `dist/drizzle` in builds), `<module dir>/../../../packages/db/drizzle`, then `<cwd>/../../packages/db/drizzle`. |
| `ETH_USD_SOURCE` | No | `none` (when unset) | `coinbase` polls `https://api.coinbase.com/v2/prices/ETH-USD/spot` every 60 s, but only while contracts are configured. The price is stored in `indexer_state.eth_usd` and used for USD display only. `none` disables it. Any other value, including empty, means exit. |
| `EXCLUDED_ADDRESSES` | No | `""` | Comma-separated `address[:label]` entries; the label defaults to `Excluded`. These addresses are never counted as citizens and are upserted into `excluded_addresses` with `kind = protocol`. An invalid address means exit. Burn addresses, the Uniswap infrastructure (plus the known Robinhood Universal Routers, Permit2, etc.) and the AtlasPad contracts are already excluded automatically. |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn` or `error`; unknown values act as `info`. Output is JSON lines, with `warn` and `error` going to stderr. |

## Contracts / Foundry (`contracts/foundry.toml`, `contracts/script/*.s.sol`)

| Variable | Used by | Required? | Default | Description |
|---|---|---|---|---|
| `ROBINHOOD_RPC_URL` | `foundry.toml` `[rpc_endpoints] robinhood` | When using `--rpc-url robinhood` | none | If missing, forge fails with ``environment variable `ROBINHOOD_RPC_URL` not found``. The public RPC is `https://rpc.mainnet.chain.robinhood.com`. |
| `BLOCKSCOUT_API_KEY` | `foundry.toml` `[etherscan] robinhood` (chain 4663, `https://robinhoodchain.blockscout.com/api/`) | When verifying on chain 4663 | none | The variable must be **defined**, because forge resolves `${BLOCKSCOUT_API_KEY}` and errors if it is missing. An empty value is accepted. |
| `EXPECTED_CHAIN_ID` | `Deploy.s.sol` (`vm.envUint`) | Yes | none | Must equal `block.chainid`. Use `4663`. |
| `UNISWAP_V2_FACTORY` | `Deploy.s.sol` (`vm.envAddress`) | Yes | none | Robinhood: `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f`. Preflight checks it has code and equals `router.factory()`. |
| `UNISWAP_V2_ROUTER` | `Deploy.s.sol` | Yes | none | Robinhood: `0x89e5db8b5aa49aa85ac63f691524311aeb649eba`. Must have code. |
| `WETH_ADDRESS` | `Deploy.s.sol` | Yes | none | Robinhood: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`. Must have code and equal `router.WETH()`. |
| `PROTOCOL_FEE_RECIPIENT` | `Deploy.s.sol` | Yes | none | Non-zero. **Immutable.** It receives the creation fees and the protocol share of trade fees through `withdrawProtocolFees()`, which anyone can call. A multisig is recommended. |
| `GRADUATION_ETH_WEI` | `Deploy.s.sol` (required); `DeployLocal.s.sol` (`vm.envOr`, default `2 ether`) | Yes for Deploy | none | Must be within 0.01–10 000 ETH. **Immutable.** It sets the curve shape for every nation. |
| `CREATION_FEE_WEI` | `Deploy.s.sol` (required); `DeployLocal.s.sol` (`vm.envOr`, default `0`) | Yes for Deploy | none | Must be ≤ 1 ETH. **Immutable.** |
| `SMOKE_CONFIRM` | `SmokeTest.s.sol` | On any chain ≠ 31337 | `""` | Must be exactly `I_UNDERSTAND`, or the script reverts with `set SMOKE_CONFIRM=I_UNDERSTAND to spend real funds`. |
| `SMOKE_NAME` | `SmokeTest.s.sol` | No | `Atlas Smoke Test` | The nation name: 2–32 characters from `[A-Za-z0-9 -.']`, no leading, trailing or double spaces. **Unique forever**, case-insensitive. |
| `SMOKE_SYMBOL` | `SmokeTest.s.sol` | No | `SMOKE` | The ticker: 2–10 characters from `[A-Z0-9]`. **Unique forever.** |
| `SMOKE_INITIAL_BUY_WEI` | `SmokeTest.s.sol` | No | `100000000000000` (0.0001 ETH) | The founder's initial curve buy, sent together with `creationFee`. |
| `SMOKE_BUY_WEI` | `SmokeTest.s.sol` | No | `200000000000000` (0.0002 ETH) | The second buy. Half of the resulting balance is then sold back. |

Because Foundry auto-loads `contracts/.env`, values there also reach `DeployLocal.s.sol`. That covers `scripts/dev-local.sh`, `seed-local.ts` and the indexer integration test, so a mainnet `GRADUATION_ETH_WEI` in `contracts/.env` changes local deployments too.

`VerifyDeployment.s.sol` reads no environment variables. It reads `contracts/deployments/<chainId>.json`.

## Local development and test tooling

| Variable | Used by | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | `scripts/dev-local.sh`, `seed-local.ts` | `postgresql://atlas:atlas@localhost:5432/atlaspad` | The database dev-local **wipes** (drops schemas `public` and `drizzle`). `seed-local.ts` also writes this value into both generated `.env.local` files. |
| `LOGS_DIR` | `scripts/dev-local.sh` | `/tmp/atlaspad-dev` | Directory for `anvil.log`, `indexer.log` and `web.log`. |
| `LOCAL_RPC_URL` | `apps/indexer/scripts/seed-local.ts` | `http://127.0.0.1:8545` | The anvil RPC. Seeding refuses to run unless the chain id is 31337. `dev-local.sh` itself always probes and starts anvil on `127.0.0.1:8545`. |
| `INTEGRATION` | `apps/indexer/test/integration.test.ts` | unset | Set it to exactly `1` to run the anvil + Postgres integration suite. Otherwise the suite is skipped. |
| `TEST_DATABASE_URL` | integration test | `postgresql://atlas:atlas@localhost:5432/atlaspad_test` | The test **drops and recreates** this database. Use a plain URL without a query string. |
| `DIGEST_DIR` | integration test | unset | When the deterministic-replay digests differ, the test writes `before.json` and `after.json` here. |
| `CHROMIUM_PATH` | `apps/web/e2e/flows.e2e.mjs` | `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` | The Chromium executable that playwright-core launches. |

`seed-local.ts` also writes `NEXT_PUBLIC_ATLAS_RPC_URL` into `apps/web/.env.local`. No code reads it; the web app reads `NEXT_PUBLIC_RPC_URL`, which the seed also writes.

---

## Secrets and sensitive values

| Value | Why it matters | Handling |
|---|---|---|
| `DATABASE_URL` (web and indexer) | Contains DB credentials. | Server-side only. Consider a separate read-only role for the web app, which only runs `SELECT`s. The indexer needs write access, and DDL rights too if `INDEXER_RUN_MIGRATIONS` is on. |
| `ADMIN_PASSWORD` (and `ADMIN_USERNAME`) | Gates the admin dashboard. | At least 12 characters, or the dashboard is disabled. Serve only over HTTPS, because Basic auth is otherwise sent in clear text. |
| `INDEXER_ADMIN_TOKEN` | Gates the indexer's `/admin/status`. That endpoint returns the RPC URL (only `user:pass@` is masked, so path or query API keys are visible), table counts and recent error messages with stack traces. | Use a long random value (for example `openssl rand -hex 32`) and set the same value on the web server. |
| `ATLAS_RPC_URL`, `ROBINHOOD_RPC_URL` | Provider URLs often embed an API key. | Keep them server-side or in the shell. **Never** put a key-bearing URL in `NEXT_PUBLIC_RPC_URL`, because it ships to every browser. |
| `BLOCKSCOUT_API_KEY` | Explorer API key, if you have one. | Shell or `contracts/.env` only. |
| Deployer key | Pays for and owns nothing after deployment: the contracts have no owner, no pause and no upgrade path. It still controls a funded mainnet account. | **No env variable reads it.** `Deploy.s.sol` calls `vm.startBroadcast()` with no argument, so the signer comes from forge CLI flags. The script header recommends an encrypted Foundry keystore: `cast wallet import deployer --interactive`, then `forge script … --account deployer` (forge prompts for the keystore password). Hardware wallets work with `--ledger` / `--trezor`. `--private-key` works but leaks the key into shell history, so avoid it on mainnet. The anvil keys hard-coded in `DeployLocal.s.sol` comments, `test/scenario.ts` and `e2e` are Foundry's public test keys and are for local use only. |

Public by design, so not secrets: every `NEXT_PUBLIC_*` value (contract addresses, WalletConnect project id, realtime URL, site URL).
