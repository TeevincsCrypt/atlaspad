import { getSeries } from "@/lib/server/queries";
import { intParam, json, withDb } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = intParam((await params).id, 0, 0);
  const days = intParam(new URL(req.url).searchParams.get("days"), 30, 1, 365);
  return withDb(async (sql) => json(await getSeries(sql, id, days), { maxAge: 30 }));
}
