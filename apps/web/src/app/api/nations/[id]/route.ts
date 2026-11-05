import { getNationDetail } from "@/lib/server/queries";
import { intParam, json, withDb } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = intParam((await params).id, 0, 0);
  return withDb(async (sql) => {
    const detail = await getNationDetail(sql, id);
    return detail ? json(detail, { maxAge: 5 }) : json({ error: "not_found" }, { status: 404 });
  });
}
