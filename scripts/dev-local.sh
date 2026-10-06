#!/usr/bin/env bash
# LOCAL DEVELOPMENT ONLY: starts a fresh anvil chain, deploys AtlasPad, seeds it with real local transactions,
# resets the local database, then runs the indexer and the web app.
#   DATABASE_URL=postgresql://atlas:atlas@localhost:5432/atlaspad ./scripts/dev-local.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${DATABASE_URL:-postgresql://atlas:atlas@localhost:5432/atlaspad}"
LOGS="${LOGS_DIR:-/tmp/atlaspad-dev}"
mkdir -p "$LOGS"

if ! cast block-number --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; then
  echo "▸ starting anvil"
  setsid nohup anvil --silent --port 8545 --timestamp "$(($(date +%s) - 7 * 86400))" </dev/null >"$LOGS/anvil.log" 2>&1 &
  sleep 2
fi

echo "▸ resetting local database"
psql "$DB" -q -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;" >/dev/null

echo "▸ deploying contracts and seeding the local world (real anvil transactions)"
(cd "$ROOT/apps/indexer" && DATABASE_URL="$DB" npx tsx scripts/seed-local.ts)

echo "▸ starting indexer (logs: $LOGS/indexer.log)"
(cd "$ROOT/apps/indexer" && setsid nohup npx tsx --env-file=.env.local src/main.ts </dev/null >"$LOGS/indexer.log" 2>&1 &)

echo "▸ starting web on http://localhost:3000 (logs: $LOGS/web.log)"
(cd "$ROOT/apps/web" && setsid nohup npx next dev --port 3000 </dev/null >"$LOGS/web.log" 2>&1 &)
echo "Done. Indexer health: http://localhost:4100/health"
