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
  let sql: postgres.Sql | null;
  try {
    sql = getSql();
  } catch (err) {
    console.error("[api] database configuration", err);
    return unavailable("The AtlasPad indexer database is misconfigured.");
  }
  if (!sql) return unavailable("The AtlasPad indexer database is not configured (DATABASE_URL).");
  try {
    return await handler(sql);
  } catch (err) {
    console.error("[api]", err);
    // Database errors (they carry a Postgres code) are safe to show and make problems diagnosable from the browser;
    // anything else stays generic. Connection strings never appear in these messages.
    const e = err as { code?: unknown; message?: unknown };
    const detail = typeof e?.code === "string" && /^[0-9A-Z]{5}$|^[A-Z_]+$/.test(e.code) ? `${e.code}: ${String(e.message ?? "").slice(0, 160)}` : (err as Error)?.name === "TypeError" ? `TypeError: ${String(e?.message ?? "").slice(0, 160)}` : null;
    return json({ error: "data_unavailable", reason: "The AtlasPad index is temporarily unavailable.", detail }, { status: 503 });
  }
}

export function intParam(value: string | null | undefined, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
