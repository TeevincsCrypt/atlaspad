import { newsItems } from "@/lib/server/queries";
import { intParam, json, withDb } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const before = url.searchParams.get("before");
  const nation = url.searchParams.get("nation");
  const severity = url.searchParams.get("severity");
  return withDb(async (sql) =>
    json(
      await newsItems(sql, {
        beforeId: before ? intParam(before, 0, 1) : undefined,
        nationId: nation ? intParam(nation, 0, 1) : undefined,
        limit: intParam(url.searchParams.get("limit"), 50, 1, 200),
        minSeverity: severity === "major" || severity === "notable" ? severity : "minor",
      }),
      { maxAge: 10 },
    ),
  );
}
