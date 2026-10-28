# AtlasPad setup guide (Windows / PowerShell)

Goal: get AtlasPad live on Robinhood Chain with $WIF. Do the parts in order. Each part says what you should see.
Deeper reference: [DEPLOYMENT.md](DEPLOYMENT.md), [ENVIRONMENT.md](ENVIRONMENT.md). Hackathon material: [HACKATHON.md](HACKATHON.md).

You will fill in settings in three places: your computer (contracts), **Railway** (the indexer) and **Vercel** (the website).

---

## Part 0. Get ready

| Need | How |
| --- | --- |
| Deployer wallet with a little ETH on Robinhood Chain (about 0.01 ETH for gas) and about 500 $WIF | Any EVM wallet. Bridge ETH and buy $WIF first. |
| Foundry (`forge`, `cast`) | `curl -L https://foundry.paradigm.xyz \| bash`, then `foundryup`, in Git Bash. |
| Keystore for the deployer | `cast wallet import deployer --interactive` (once). Check with `cast wallet address --account deployer`. |
| A Postgres database | neon.tech (free): create a project and copy the connection string. |
| Railway and Vercel accounts | railway.app, and your existing Vercel project. |

**PowerShell can't find `forge`?** Run `$env:Path += ";$HOME\.foundry\bin"` (per window).

## Part 1. Get the code

Preferred (needs a working connection to github.com):

```powershell
cd $HOME
git clone --depth 1 --branch claude/dreamy-dirac-hojyxe --recurse-submodules --shallow-submodules https://github.com/TeevincsCrypt/atlaspad.git
```

If that stalls or says "could not resolve host", download in your browser instead:
the project zip (`https://github.com/TeevincsCrypt/atlaspad/archive/refs/heads/claude/dreamy-dirac-hojyxe.zip`),
`https://github.com/foundry-rs/forge-std/archive/refs/tags/v1.9.7.zip` and the small
`https://registry.npmjs.org/@openzeppelin/contracts/-/contracts-5.6.1.tgz`, then:

```powershell
Remove-Item -Recurse -Force "$HOME\atlaspad","$HOME\libs" -ErrorAction SilentlyContinue
cd "$HOME\Downloads"
Expand-Archive .\atlaspad-*.zip -DestinationPath "$HOME"
Rename-Item (Get-Item "$HOME\atlaspad-*") "atlaspad"
Expand-Archive .\forge-std-*.zip -DestinationPath "$HOME\libs"
Remove-Item -Recurse -Force "$HOME\atlaspad\contracts\lib\forge-std","$HOME\atlaspad\contracts\lib\openzeppelin-contracts" -ErrorAction SilentlyContinue
Move-Item "$HOME\libs\forge-std-*" "$HOME\atlaspad\contracts\lib\forge-std"
$oz = "$HOME\atlaspad\contracts\lib\openzeppelin-contracts\contracts"
mkdir $oz
tar -xzf (Get-Item "$HOME\Downloads\contracts-*.tgz").FullName -C $oz --strip-components=1
mkdir "$HOME\atlaspad\contracts\deployments" -ErrorAction SilentlyContinue
dir "$oz\token\ERC20"
```

You should see `ERC20.sol`, `IERC20.sol` and an `extensions` folder.

## Part 2. Deploy the contracts

Create `contracts\.env` (replace `YOUR_ADDRESS`; the fee recipient can **never** be changed later):

```powershell
cd "$HOME\atlaspad\contracts"
@"
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
BLOCKSCOUT_API_KEY=
EXPECTED_CHAIN_ID=4663
UNISWAP_V2_FACTORY=0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f
UNISWAP_V2_ROUTER=0x89e5db8b5aa49aa85ac63f691524311aeb649eba
WIF_ADDRESS=0x5173b8eA6923c2d40267890D45C46a3480954773
PROTOCOL_FEE_RECIPIENT=YOUR_ADDRESS
GRADUATION_WIF=200000000000000000000000
CREATION_FEE_WIF=100000000000000000000
"@ | Set-Content -Encoding ascii .env
```

Build, test, and do the free dry run:

```powershell
forge build
forge test          # takes several minutes on Windows; look for "0 failed"
forge script script/Deploy.s.sol --rpc-url robinhood --account deployer
```

The dry run must print `WIF token WIF 18` (**18 decimals**, otherwise stop), `Preflight OK on chain 4663` and `Postflight OK`.

Deploy for real (the same command plus `--broadcast`), then verify:

```powershell
forge script script/Deploy.s.sol --rpc-url robinhood --account deployer --broadcast
forge script script/VerifyDeployment.s.sol --rpc-url robinhood
```

Do not send other transactions from the deployer wallet while it runs. You should see `Deployment recorded at ...\deployments\4663.json`.

Optional but nice for judges, source verification on the explorer (retry per contract if it fails; see DEPLOYMENT.md §4.4):

```powershell
forge script script/Deploy.s.sol --rpc-url robinhood --account deployer --resume --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```

First proof transactions (spends about 400 $WIF and burns 100 of it):

```powershell
$env:SMOKE_NAME="Atlas Genesis"; $env:SMOKE_SYMBOL="GENESIS"; $env:SMOKE_CONFIRM="I_UNDERSTAND"
forge script script/SmokeTest.s.sol --rpc-url robinhood --account deployer --broadcast
```

## Part 3. Print your hosting variables

From the repository root (this fills in the addresses and the start block for you):

```powershell
cd "$HOME\atlaspad"
.\scripts\print-env.ps1 -Database "postgresql://..." -Indexer "https://YOUR-RAILWAY-URL" -Site "https://useatlaspad.vercel.app"
```

It prints one block for Railway and one for Vercel. If PowerShell refuses to run the script, run `Set-ExecutionPolicy -Scope Process Bypass` first. Never put the database URL or admin token in a variable that starts with `NEXT_PUBLIC_`.

## Part 4. Indexer on Railway

1. railway.app, New Project, Deploy from GitHub repo, `TeevincsCrypt/atlaspad`, branch `claude/dreamy-dirac-hojyxe`. The root `Dockerfile` builds the indexer automatically.
2. Variables tab: paste the **RAILWAY** block from Part 3.
3. Settings, Networking: Generate Domain. Use that URL for `-Indexer` in Part 3 (run it again afterwards so both blocks have it).
4. Check `https://YOUR-RAILWAY-URL/health`: you should see `"ok":true,"deployed":true`, with `lagBlocks` falling toward 0.

## Part 5. Website on Vercel

1. Project, Settings, Environment Variables: paste the **VERCEL** block from Part 3. Optional: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (free at cloud.reown.com) for mobile wallets, and `ADMIN_USERNAME` / `ADMIN_PASSWORD` (12+ characters) for `/admin`.
2. Deployments, the latest one, Redeploy. `NEXT_PUBLIC_` values only apply after a rebuild.
3. Check `https://useatlaspad.vercel.app/api/status`: you should see `"deployed":true` and `"database":"ok"`. The blue banner is gone and your GENESIS nation is on the map.

## Part 6. Submit

Follow [HACKATHON.md](HACKATHON.md) section 5 and fill in its proof-transaction table: found a nation, buy, sell, propose and vote from the website with your own wallet, then copy the explorer links. Keep the indexer and website running until the final closes.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `forge` not recognized in PowerShell | `$env:Path += ";$HOME\.foundry\bin"` |
| "Could not resolve host" | Network or DNS. Turn off VPN, set DNS to 1.1.1.1 and 8.8.8.8, or use the browser downloads in Part 1. |
| Deploy fails at the very end with a file error | The folder `contracts\deployments` is missing. `mkdir contracts\deployments`, then read the addresses from `contracts\broadcast\Deploy.s.sol\4663\run-latest.json`. **Do not deploy twice.** |
| Site says "Data unavailable" | Contracts, database or indexer not configured yet (Parts 2 to 5), or Vercel was not redeployed. |
| Indexer shows `"deployed":false` | `ATLAS_LAUNCHPAD`, `ATLAS_GOVERNOR` or `ATLAS_TREASURY` is missing or mistyped in Railway. |
| Wallet says insufficient funds on a trade | Trades are paid in $WIF, but gas is paid in ETH. The wallet needs both. |
