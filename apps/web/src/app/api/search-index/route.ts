import { getSearchIndex } from "@/lib/server/queries";
import { json, withDb } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return withDb(async (sql) => json(await getSearchIndex(sql), { maxAge: 15 }));
}
