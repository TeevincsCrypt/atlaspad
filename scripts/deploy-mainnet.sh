#!/usr/bin/env bash
# One-command AtlasPad deployment to Robinhood Chain. Run it from anywhere inside the repository:
#   bash scripts/deploy-mainnet.sh
# Needs Foundry (forge) and a keystore called "deployer" (cast wallet import deployer --interactive).
# It asks you three questions, runs a free dry run, stops unless $WIF has 18 decimals, asks you to type DEPLOY,
# sends the real transactions, verifies them on-chain and prints the variables for Railway and Vercel.
#
# Overrides (used for testing): CHAIN_ID, RPC_URL (alias or URL), SIGNER_ARGS, and any variable from
# contracts/.env exported in the shell.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"
export PATH="$PATH:$HOME/.foundry/bin"
command -v forge >/dev/null 2>&1 || { echo "forge not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash   then run: foundryup"; exit 1; }

export CHAIN_ID="${CHAIN_ID:-4663}"
RPC="${RPC_URL:-robinhood}"
SIGNER="${SIGNER_ARGS:---account deployer}"
mkdir -p deployments

[ -f "lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol" ] && [ -f "lib/forge-std/src/Test.sol" ] || {
  echo "The libraries are missing. Run: git submodule update --init --recursive --depth 1"; exit 1; }
if [ -f "$ROOT/contracts/deployments/$CHAIN_ID.json" ]; then
  echo "A deployment record already exists: contracts/deployments/$CHAIN_ID.json"
  echo "Deploying again would create a second, separate AtlasPad. If that is really what you want, move that file away first."
  exit 1
fi

# ---- settings -------------------------------------------------------------------------------------
whole_to_units() { case "$1" in ''|*[!0-9]*) echo "Please enter a whole number, like 100." >&2; return 1;; esac; echo "${1}000000000000000000"; }
if [ -z "${PROTOCOL_FEE_RECIPIENT:-}" ] && [ ! -f .env ]; then
  echo "A few settings. These are permanent once deployed."
  read -r -p "1/3  Wallet address that receives the protocol's fee share: " PROTOCOL_FEE_RECIPIENT
  read -r -p "2/3  Launch fee in WIF, burned on every new nation [100]: " CF; CF="${CF:-100}"
  read -r -p "3/3  WIF a nation must raise before it graduates to Uniswap [200000]: " GR; GR="${GR:-200000}"
  CREATION_FEE_WIF="$(whole_to_units "$CF")"; GRADUATION_WIF="$(whole_to_units "$GR")"
  case "$PROTOCOL_FEE_RECIPIENT" in 0x[0-9a-fA-F][0-9a-fA-F]*) [ "${#PROTOCOL_FEE_RECIPIENT}" = 42 ] || { echo "That address is not 42 characters."; exit 1; };; *) echo "That does not look like a wallet address."; exit 1;; esac
  cat > .env <<ENVEOF
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
BLOCKSCOUT_API_KEY=
EXPECTED_CHAIN_ID=4663
UNISWAP_V2_FACTORY=0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f
UNISWAP_V2_ROUTER=0x89e5db8b5aa49aa85ac63f691524311aeb649eba
WIF_ADDRESS=0x5173b8eA6923c2d40267890D45C46a3480954773
PROTOCOL_FEE_RECIPIENT=$PROTOCOL_FEE_RECIPIENT
GRADUATION_WIF=$GRADUATION_WIF
CREATION_FEE_WIF=$CREATION_FEE_WIF
ENVEOF
  echo "Saved contracts/.env"
fi

# ---- build and dry run ------------------------------------------------------------------------------
echo; echo "== Building =="; forge build
echo; echo "== Dry run (spends nothing) =="
LOG="$(mktemp)"
# shellcheck disable=SC2086
forge script script/Deploy.s.sol --rpc-url "$RPC" $SIGNER 2>&1 | tee "$LOG"
grep -q "Postflight OK" "$LOG" || { echo; echo "The dry run did not finish with 'Postflight OK'. Nothing was deployed. Send me the output above."; exit 1; }
WIFLINE="$(grep -m1 "WIF token" "$LOG" || true)"
echo; echo "Token check -> $WIFLINE"
case "$WIFLINE" in *" 18") ;; *) echo "STOP: \$WIF does not report 18 decimals (or the check line is missing). Nothing was deployed. Send me the output above."; exit 1;; esac

# ---- real deployment ------------------------------------------------------------------------------
echo; echo "The dry run passed and \$WIF reports 18 decimals. The next step sends REAL transactions (gas in ETH)."
read -r -p "Type DEPLOY to continue, anything else to stop: " ANS
[ "$ANS" = "DEPLOY" ] || { echo "Stopped. Nothing was deployed."; exit 0; }
# shellcheck disable=SC2086
forge script script/Deploy.s.sol --rpc-url "$RPC" $SIGNER --broadcast
echo; echo "== Checking the live contracts =="
forge script script/VerifyDeployment.s.sol --rpc-url "$RPC"

echo; echo "Optional: publish the source code on the explorer (safe to skip or retry later)."
read -r -p "Try now? [y/N] " V
if [ "${V:-n}" = "y" ] || [ "${V:-n}" = "Y" ]; then
  # shellcheck disable=SC2086
  forge script script/Deploy.s.sol --rpc-url "$RPC" $SIGNER --resume --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/ || echo "Verification did not finish. Retry later; the deployment itself is fine."
fi

echo; echo "== Done. Your variables for Railway and Vercel (fill in the database and Railway URL later) =="
bash "$ROOT/scripts/print-env.sh" || true
