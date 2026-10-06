import { getCandles } from "@/lib/server/queries";
import { intParam, json, withDb } from "@/lib/server/http";

export const dynamic = "force-dynamic";
const INTERVALS = [60, 300, 900, 3600, 14400, 86400];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = intParam((await params).id, 0, 0);
  const requested = intParam(new URL(req.url).searchParams.get("interval"), 900);
  const interval = INTERVALS.includes(requested) ? requested : 900;
  return withDb(async (sql) => json(await getCandles(sql, id, interval), { maxAge: 2 }));
}
