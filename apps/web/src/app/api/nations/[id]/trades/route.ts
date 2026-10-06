import { getTrades } from "@/lib/server/queries";
import { intParam, json, withDb } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = intParam((await params).id, 0, 0);
  const limit = intParam(new URL(req.url).searchParams.get("limit"), 50, 1, 200);
  return withDb(async (sql) => json(await getTrades(sql, { nationId: id, limit }), { maxAge: 2 }));
}
