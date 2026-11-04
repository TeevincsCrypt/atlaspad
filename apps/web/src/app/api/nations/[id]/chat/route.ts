import { CHAT_COOLDOWN_SEC, cleanChatMessage } from "@atlaspad/shared";
import { getChatMessages } from "@/lib/server/queries";
import { chatCookieFrom, readChatToken } from "@/lib/server/chat-session";
import { intParam, json, withDb } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const missingTable = (err: unknown) => (err as { code?: string })?.code === "42P01";

/** Latest messages (or only those after `?after=<id>`). Anyone can read. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = intParam((await params).id, -1, 1);
  if (id < 1) return json({ error: "invalid_id" }, { status: 400 });
  const after = intParam(new URL(req.url).searchParams.get("after"), 0, 0);
  return withDb(async (sql) => {
    try {
      return json({ messages: await getChatMessages(sql, id, after) });
    } catch (err) {
      if (missingTable(err)) return json({ messages: [], disabled: true });
      throw err;
    }
  });
}

/** Post a message. Requires a chat sign-in, and the author must be a citizen (or the founder) of this nation. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = intParam((await params).id, -1, 1);
  if (id < 1) return json({ error: "invalid_id" }, { status: 400 });
  const author = readChatToken(chatCookieFrom(req));
  if (!author) return json({ error: "signed_out", message: "Sign in to chat first." }, { status: 401 });
  let raw: { body?: unknown };
  try {
    raw = await req.json();
  } catch {
    return json({ error: "invalid_body" }, { status: 400 });
  }
  const body = cleanChatMessage(typeof raw.body === "string" ? raw.body : "");
  if (!body) return json({ error: "invalid_message", message: "Messages must be 1 to 500 characters." }, { status: 400 });

  return withDb(async (sql) => {
    const [n] = await sql`
      SELECT n.founder, n.total_supply, COALESCE(h.balance, 0) AS balance
      FROM nations n LEFT JOIN holders h ON h.nation_id = n.id AND h.address = ${author}
      WHERE n.id = ${id}`;
    if (!n) return json({ error: "not_found" }, { status: 404 });
    // Same threshold as a citizen everywhere else: at least 0.0001% of supply.
    const citizen = BigInt(String(n.balance)) * 1_000_000n >= BigInt(String(n.total_supply));
    if (!citizen && n.founder !== author) return json({ error: "not_citizen", message: "Only citizens can post. Buy this nation's token to join." }, { status: 403 });
    const now = Math.floor(Date.now() / 1000);
    try {
      const [last] = await sql`SELECT created_at FROM nation_messages WHERE author = ${author} ORDER BY created_at DESC LIMIT 1`;
      if (last && now - Number(last.created_at) < CHAT_COOLDOWN_SEC) return json({ error: "slow_down", message: "Slow down a little." }, { status: 429 });
      const [row] = await sql`INSERT INTO nation_messages (nation_id, author, body, created_at) VALUES (${id}, ${author}, ${body}, ${now}) RETURNING id`;
      return json({ id: Number(row!.id) });
    } catch (err) {
      if (missingTable(err)) return json({ error: "not_ready", message: "Chat is not enabled yet: redeploy the indexer so its database migration runs." }, { status: 503 });
      throw err;
    }
  });
}
