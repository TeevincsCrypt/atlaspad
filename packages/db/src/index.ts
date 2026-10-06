import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };
export type AtlasDb = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: AtlasDb;
  sql: postgres.Sql;
  close: () => Promise<void>;
}

export function createDb(url: string, opts: { max?: number; ssl?: boolean } = {}): DbHandle {
  const sql = postgres(url, {
    max: opts.max ?? 10,
    ssl: opts.ssl ? "require" : undefined,
    // numeric(78,0) stays a string; bigint columns use mode "number" in the schema
    types: { bigint: postgres.BigInt },
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}
export * from "./queries";
