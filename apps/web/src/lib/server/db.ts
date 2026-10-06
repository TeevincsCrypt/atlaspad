import "server-only";
import postgres from "postgres";

const globalForDb = globalThis as unknown as { __atlasSql?: postgres.Sql };

/** Shared read-only connection pool, or null when DATABASE_URL is not configured. */
export function getSql(): postgres.Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!globalForDb.__atlasSql) {
    globalForDb.__atlasSql = postgres(url, {
      max: poolMax(),
      ssl: process.env.DATABASE_SSL === "true" ? "require" : undefined,
      idle_timeout: 20,
      connect_timeout: 10,
      // Compatible with transaction-mode poolers (PgBouncer, Neon, Supabase).
      prepare: false,
      onnotice: () => {},
    });
  }
  return globalForDb.__atlasSql;
}

function poolMax(): number {
  const raw = process.env.DATABASE_POOL_MAX;
  if (!raw) return 3;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error("DATABASE_POOL_MAX must be a positive integer");
  return n;
}
