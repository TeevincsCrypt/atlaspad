import "server-only";
import { NextResponse } from "next/server";
import type postgres from "postgres";
import { getSql } from "./db";

export function json(data: unknown, opts: { status?: number; maxAge?: number } = {}) {
  return NextResponse.json(data, {
    status: opts.status ?? 200,
    headers: {
      "Cache-Control": opts.maxAge
        ? `public, s-maxage=${opts.maxAge}, stale-while-revalidate=${opts.maxAge * 4}`
        : "no-store",
    },
  });
}

export function unavailable(reason: string) {
  return json({ error: "data_unavailable", reason }, { status: 503 });
}

/** Run a handler with the database, or answer 503 "data unavailable" — never fabricated data. */
export async function withDb(handler: (sql: postgres.Sql) => Promise<Response>): Promise<Response> {
  const sql = getSql();
  if (!sql) return unavailable("The AtlasPad indexer database is not configured (DATABASE_URL).");
  try {
    return await handler(sql);
  } catch (err) {
    console.error("[api]", err);
    return unavailable("The AtlasPad index is temporarily unavailable.");
  }
}

export function intParam(value: string | null | undefined, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
