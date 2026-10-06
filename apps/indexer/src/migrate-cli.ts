/** Apply database migrations and exit: `node dist/migrate-cli.js` (or `pnpm --filter @atlaspad/indexer migrate`). */
import { runMigrations } from "./migrate";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
await runMigrations(url, process.env.DATABASE_SSL === "true");
console.log("Migrations applied");
