import { migrate } from "drizzle-orm/postgres-js/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "./index";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const { db, close } = createDb(url, { max: 1, ssl: process.env.DATABASE_SSL === "true" });
await migrate(db, { migrationsFolder: resolve(here, "../drizzle") });
await close();
console.log("Migrations applied");
