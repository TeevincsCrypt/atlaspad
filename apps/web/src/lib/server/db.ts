import "server-only";
import postgres from "postgres";

const globalForDb = globalThis as unknown as { __atlasSql?: postgres.Sql; __atlasDbMode?: DbMode };

export type DbMode = "transaction-pooler" | "session-pooler" | "direct" | "unknown";

/**
 * Serverless functions open many short-lived connections. Supabase's session pooler (port 5432 on
 * *.pooler.supabase.com) allows only a small, fixed number of clients, which the indexer also uses, so web requests
 * end up waiting for a free slot and pages hang on "loading". Its transaction pooler (port 6543, same credentials) is
 * built for this, so a session-pooler URL is switched to it automatically. Set DATABASE_KEEP_PORT=true to opt out.
 */
export function webDatabaseUrl(raw: string): { url: string; mode: DbMode } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { url: raw, mode: "unknown" };
  }
  const supabasePooler = u.hostname.endsWith(".pooler.supabase.com");
  const port = u.port || "5432";
  if (supabasePooler && port === "5432" && process.env.DATABASE_KEEP_PORT !== "true") {
    u.port = "6543";
    return { url: u.toString(), mode: "transaction-pooler" };
  }
  if (supabasePooler) return { url: raw, mode: port === "6543" ? "transaction-pooler" : "session-pooler" };
  return { url: raw, mode: "direct" };
}

/** Shared connection pool, or null when DATABASE_URL is not configured. */
export function getSql(): postgres.Sql | null {
  const raw = process.env.DATABASE_URL;
  if (!raw) return null;
  if (!globalForDb.__atlasSql) {
    const { url, mode } = webDatabaseUrl(raw);
    globalForDb.__atlasDbMode = mode;
    globalForDb.__atlasSql = postgres(url, {
      max: poolMax(),
      ssl: process.env.DATABASE_SSL === "true" ? "require" : undefined,
      // Release idle connections quickly: each serverless instance has its own pool.
      idle_timeout: 5,
      max_lifetime: 5 * 60,
      connect_timeout: 8,
      // Compatible with transaction-mode poolers (PgBouncer, Neon, Supabase).
      prepare: false,
      onnotice: () => {},
    });
  }
  return globalForDb.__atlasSql;
}

export function dbMode(): DbMode {
  return globalForDb.__atlasDbMode ?? "unknown";
}

function poolMax(): number {
  const raw = process.env.DATABASE_POOL_MAX;
  if (!raw) return 2;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error("DATABASE_POOL_MAX must be a positive integer");
  return n;
}

/** Resolves to `fallback` if `p` takes longer than `ms` (for non-essential reads such as page titles). */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}
