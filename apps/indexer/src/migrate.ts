import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Locate the Drizzle migrations both from source (tsx) and from the bundled build (dist/drizzle). */
export function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MIGRATIONS_DIR,
    resolve(here, "drizzle"),
    resolve(here, "../../../packages/db/drizzle"),
    resolve(process.cwd(), "../../packages/db/drizzle"),
  ].filter(Boolean) as string[];
  const found = candidates.find((c) => existsSync(resolve(c, "meta/_journal.json")));
  if (!found) throw new Error(`Drizzle migrations not found (looked in ${candidates.join(", ")})`);
  return found;
}

export async function runMigrations(url: string, ssl: boolean) {
  const sql = postgres(url, { max: 1, ssl: ssl ? "require" : undefined, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: migrationsDir() });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
