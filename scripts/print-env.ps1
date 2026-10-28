# After deploying the contracts, prints every environment variable you need for Railway (indexer) and
# Vercel (web), already filled in from contracts\deployments\4663.json and the broadcast receipts.
#
# Run from the repository root, in PowerShell:
#   .\scripts\print-env.ps1 -Database "postgresql://..." -Indexer "https://your-app.up.railway.app"
param(
  [string]$Database = "<your Postgres URL>",
  [string]$Indexer = "<your Railway URL>",
  [string]$Site = "https://useatlaspad.vercel.app"
)

$root = Split-Path -Parent $PSScriptRoot
$depFile = Join-Path $root "contracts\deployments\4663.json"
if (-not (Test-Path $depFile)) { Write-Host "Not found: $depFile. Deploy the contracts first."; exit 1 }
$dep = Get-Content $depFile -Raw | ConvertFrom-Json

# Block to start indexing from: the first block of the real deployment transactions, a little earlier to be safe.
function ToBlock($v) {
  if ($v -is [string] -and $v.StartsWith("0x")) { return [Convert]::ToInt64($v.Substring(2), 16) }
  return [int64]$v
}
$block = [int64]$dep.deployedAtBlock
$runFile = Join-Path $root "contracts\broadcast\Deploy.s.sol\4663\run-latest.json"
if (Test-Path $runFile) {
  $run = Get-Content $runFile -Raw | ConvertFrom-Json
  $blocks = @($run.receipts | ForEach-Object { ToBlock $_.blockNumber })
  if ($blocks.Count -gt 0) { $block = ($blocks | Measure-Object -Minimum).Minimum }
}
$block = [Math]::Max(0, $block - 5)

$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = -join ($bytes | ForEach-Object { $_.ToString("x2") })
$indexerUrl = $Indexer.TrimEnd("/")

Write-Host ""
Write-Host "================ RAILWAY (indexer) ================"
Write-Host @"
ATLAS_NETWORK=robinhood
ATLAS_RPC_URL=https://rpc.mainnet.chain.robinhood.com
ATLAS_LAUNCHPAD=$($dep.launchpad)
ATLAS_GOVERNOR=$($dep.governor)
ATLAS_TREASURY=$($dep.treasury)
ATLAS_DEPLOY_BLOCK=$block
DATABASE_URL=$Database
DATABASE_SSL=true
WIF_USD_SOURCE=dexscreener
INDEXER_CORS_ORIGIN=$Site
INDEXER_ADMIN_TOKEN=$token
"@
Write-Host "================ VERCEL (web) ================"
Write-Host @"
NEXT_PUBLIC_ATLAS_NETWORK=robinhood
NEXT_PUBLIC_ATLAS_LAUNCHPAD=$($dep.launchpad)
NEXT_PUBLIC_ATLAS_GOVERNOR=$($dep.governor)
NEXT_PUBLIC_ATLAS_TREASURY=$($dep.treasury)
NEXT_PUBLIC_ATLAS_DEPLOY_BLOCK=$block
NEXT_PUBLIC_REALTIME_URL=$indexerUrl
NEXT_PUBLIC_SITE_URL=$Site
DATABASE_URL=$Database
DATABASE_SSL=true
INDEXER_URL=$indexerUrl
INDEXER_ADMIN_TOKEN=$token
"@
Write-Host "Keep the DATABASE_URL and INDEXER_ADMIN_TOKEN lines private. Never paste them into a NEXT_PUBLIC_ variable."
