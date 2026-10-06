import { getHolders } from "@/lib/server/queries";
import { intParam, json, withDb } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = intParam((await params).id, 0, 0);
  const limit = intParam(new URL(req.url).searchParams.get("limit"), 100, 1, 500);
  return withDb(async (sql) => json(await getHolders(sql, id, limit), { maxAge: 5 }));
}
