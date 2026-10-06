import { isAddress } from "viem";
import { getCitizen, getProposals, getTrades } from "@/lib/server/queries";
import { json, withDb } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address, { strict: false })) return json({ error: "invalid_address" }, { status: 400 });
  return withDb(async (sql) => {
    const a = address.toLowerCase();
    const [profile, trades, proposals] = await Promise.all([
      getCitizen(sql, a),
      getTrades(sql, { trader: a, limit: 25 }),
      getProposals(sql, { proposer: a, limit: 25 }),
    ]);
    return json({ profile, trades, proposals }, { maxAge: 5 });
  });
}
