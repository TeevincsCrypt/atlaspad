import "server-only";
import postgres from "postgres";

const globalForDb = globalThis as unknown as { __atlasSql?: postgres.Sql };

/** Shared read-only connection pool, or null when DATABASE_URL is not configured. */
export function getSql(): postgres.Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!globalForDb.__atlasSql) {
    globalForDb.__atlasSql = postgres(url, {
      max: Number(process.env.DATABASE_POOL_MAX ?? 3),
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
