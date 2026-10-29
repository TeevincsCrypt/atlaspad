#!/usr/bin/env bash
# After deploying, prints every environment variable you need for Railway (indexer) and Vercel (web),
# filled in from contracts/deployments/<chain>.json and the broadcast receipts.
#   bash scripts/print-env.sh "postgresql://..." "https://your-app.up.railway.app" "https://useatlaspad.vercel.app"
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHAIN_ID="${CHAIN_ID:-4663}"
DATABASE="${1:-<your Postgres URL>}"
INDEXER="${2:-<your Railway URL>}"
SITE="${3:-https://useatlaspad.vercel.app}"
DEP="$ROOT/contracts/deployments/$CHAIN_ID.json"
[ -f "$DEP" ] || { echo "Not found: $DEP. Deploy the contracts first."; exit 1; }

# Reads a flat string or number field from the deployment record.
field() { sed -n "s/.*\"$1\": *\"\{0,1\}\([^\",]*\)\"\{0,1\}.*/\1/p" "$DEP" | head -1; }

# Start block for the indexer: the first block of the real deployment transactions, a little earlier to be safe.
BLOCK="$(field deployedAtBlock)"
RUN="$ROOT/contracts/broadcast/Deploy.s.sol/$CHAIN_ID/run-latest.json"
if [ -f "$RUN" ]; then
  MIN=""
  for v in $(grep -o '"blockNumber": *"\{0,1\}\(0x[0-9a-fA-F]*\|[0-9]*\)' "$RUN" | sed 's/.*: *"\{0,1\}//'); do
    case "$v" in 0x*) n=$((16#${v#0x}));; *) n=$((v));; esac
    if [ -z "$MIN" ] || [ "$n" -lt "$MIN" ]; then MIN=$n; fi
  done
  [ -n "$MIN" ] && BLOCK="$MIN"
fi
BLOCK=$(( BLOCK > 5 ? BLOCK - 5 : 0 ))

if command -v openssl >/dev/null 2>&1; then TOKEN="$(openssl rand -hex 32)"; else TOKEN="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"; fi
INDEXER="${INDEXER%/}"
LP="$(field launchpad)"; GOV="$(field governor)"; TRE="$(field treasury)"

cat <<OUT

================ RAILWAY (indexer) ================
ATLAS_NETWORK=robinhood
ATLAS_RPC_URL=https://rpc.mainnet.chain.robinhood.com
ATLAS_LAUNCHPAD=$LP
ATLAS_GOVERNOR=$GOV
ATLAS_TREASURY=$TRE
ATLAS_DEPLOY_BLOCK=$BLOCK
DATABASE_URL=$DATABASE
DATABASE_SSL=true
WIF_USD_SOURCE=dexscreener
INDEXER_CORS_ORIGIN=$SITE
INDEXER_ADMIN_TOKEN=$TOKEN

================ VERCEL (web) ================
NEXT_PUBLIC_ATLAS_NETWORK=robinhood
NEXT_PUBLIC_ATLAS_LAUNCHPAD=$LP
NEXT_PUBLIC_ATLAS_GOVERNOR=$GOV
NEXT_PUBLIC_ATLAS_TREASURY=$TRE
NEXT_PUBLIC_ATLAS_DEPLOY_BLOCK=$BLOCK
NEXT_PUBLIC_REALTIME_URL=$INDEXER
NEXT_PUBLIC_SITE_URL=$SITE
DATABASE_URL=$DATABASE
DATABASE_SSL=true
INDEXER_URL=$INDEXER
INDEXER_ADMIN_TOKEN=$TOKEN

Keep the DATABASE_URL and INDEXER_ADMIN_TOKEN lines private. Never put them in a NEXT_PUBLIC_ variable.
OUT
