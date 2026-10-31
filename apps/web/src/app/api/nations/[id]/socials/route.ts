import { createPublicClient, http, isHex } from "viem";
import { EMPTY_SOCIALS, SOCIALS_SIGNATURE_TTL_SEC, normalizeSocials, socialsMessage } from "@atlaspad/shared";
import { network, publicEnv } from "@/lib/env";
import { getSocials } from "@/lib/server/queries";
import { intParam, json, withDb } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const missingTable = (err: unknown) => (err as { code?: string })?.code === "42P01";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = intParam((await params).id, -1, 1);
  if (id < 1) return json({ error: "invalid_id" }, { status: 400 });
  return withDb(async (sql) => json({ socials: (await getSocials(sql, id)) ?? EMPTY_SOCIALS }, { maxAge: 10 }));
}

/**
 * Save a nation's social links. Only the founder can, by signing the exact `socialsMessage` text with the founder
 * wallet (EOA or smart wallet). Links are normalised to x.com / t.me / https URLs before they are stored.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = intParam((await params).id, -1, 1);
  if (id < 1) return json({ error: "invalid_id" }, { status: 400 });
  let body: { x?: unknown; telegram?: unknown; website?: unknown; issuedAt?: unknown; signature?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, { status: 400 });
  }
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 300) : "");
  const norm = normalizeSocials({ x: str(body.x), telegram: str(body.telegram), website: str(body.website) });
  if (!norm.ok) return json({ error: "invalid_link", field: norm.field }, { status: 400 });
  const issuedAt = Number(body.issuedAt);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(issuedAt) || Math.abs(now - issuedAt) > SOCIALS_SIGNATURE_TTL_SEC) {
    return json({ error: "expired", message: "The signature expired. Sign again." }, { status: 400 });
  }
  const signature = body.signature;
  if (typeof signature !== "string" || !isHex(signature) || signature.length > 4000) return json({ error: "invalid_signature" }, { status: 400 });

  return withDb(async (sql) => {
    const [row] = await sql`SELECT founder FROM nations WHERE id = ${id}`;
    if (!row) return json({ error: "not_found" }, { status: 404 });
    const founder = String(row.founder) as `0x${string}`;
    const message = socialsMessage(network.chain.id, id, norm.socials, issuedAt);
    const client = createPublicClient({ chain: network.chain, transport: http(publicEnv.rpcUrl || undefined) });
    let valid = false;
    try {
      // Handles plain wallets and smart-contract wallets (ERC-1271 / ERC-6492).
      valid = await client.verifyMessage({ address: founder, message, signature });
    } catch {
      valid = false;
    }
    if (!valid) return json({ error: "not_founder", message: "Only the founder's wallet can change these links." }, { status: 403 });
    try {
      await sql`
        INSERT INTO nation_socials (nation_id, x, telegram, website, signer, updated_at)
        VALUES (${id}, ${norm.socials.x}, ${norm.socials.telegram}, ${norm.socials.website}, ${founder.toLowerCase()}, ${issuedAt})
        ON CONFLICT (nation_id) DO UPDATE SET x = EXCLUDED.x, telegram = EXCLUDED.telegram, website = EXCLUDED.website,
          signer = EXCLUDED.signer, updated_at = EXCLUDED.updated_at
        WHERE nation_socials.updated_at < EXCLUDED.updated_at`;
    } catch (err) {
      if (missingTable(err)) return json({ error: "not_ready", message: "Social links are not enabled yet: redeploy the indexer so its database migration runs." }, { status: 503 });
      throw err;
    }
    return json({ socials: norm.socials });
  });
}
