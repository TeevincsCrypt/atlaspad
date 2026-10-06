import { getTopCitizens } from "@/lib/server/queries";
import { intParam, json, withDb } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limit = intParam(new URL(req.url).searchParams.get("limit"), 50, 1, 200);
  return withDb(async (sql) => json(await getTopCitizens(sql, limit), { maxAge: 10 }));
}
