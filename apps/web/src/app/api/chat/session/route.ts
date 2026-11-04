import { NextResponse } from "next/server";
import { createPublicClient, http, isAddress, isHex } from "viem";
import { CHAT_SESSION_TTL_SEC, CHAT_SIGNIN_TTL_SEC, chatSignInMessage } from "@atlaspad/shared";
import { network, publicEnv } from "@/lib/env";
import { CHAT_COOKIE, chatCookieFrom, issueChatToken, readChatToken } from "@/lib/server/chat-session";

export const dynamic = "force-dynamic";

const cookie = (value: string, maxAge: number) =>
  `${CHAT_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

/** Who is signed in to chat on this browser. */
export async function GET(req: Request) {
  return NextResponse.json({ address: readChatToken(chatCookieFrom(req)) }, { headers: { "Cache-Control": "no-store" } });
}

/** Sign in with one free wallet signature of `chatSignInMessage` (works for plain and smart-contract wallets). */
export async function POST(req: Request) {
  let body: { address?: unknown; issuedAt?: unknown; signature?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const address = typeof body.address === "string" ? body.address : "";
  const issuedAt = Number(body.issuedAt);
  const signature = body.signature;
  if (!isAddress(address, { strict: false })) return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  if (!Number.isInteger(issuedAt) || Math.abs(Date.now() / 1000 - issuedAt) > CHAT_SIGNIN_TTL_SEC) return NextResponse.json({ error: "expired", message: "The sign-in expired. Try again." }, { status: 400 });
  if (typeof signature !== "string" || !isHex(signature) || signature.length > 4000) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  const client = createPublicClient({ chain: network.chain, transport: http(publicEnv.rpcUrl || undefined) });
  let ok = false;
  try {
    ok = await client.verifyMessage({ address: address as `0x${string}`, message: chatSignInMessage(network.chain.id, address, issuedAt), signature });
  } catch {
    ok = false;
  }
  if (!ok) return NextResponse.json({ error: "bad_signature", message: "That signature doesn't match this wallet." }, { status: 401 });
  const token = issueChatToken(address);
  if (!token) return NextResponse.json({ error: "not_configured", message: "Chat is not configured on this deployment." }, { status: 503 });
  return NextResponse.json({ address: address.toLowerCase() }, { headers: { "Set-Cookie": cookie(token, CHAT_SESSION_TTL_SEC), "Cache-Control": "no-store" } });
}

/** Sign out of chat. */
export async function DELETE() {
  return NextResponse.json({ address: null }, { headers: { "Set-Cookie": cookie("", 0), "Cache-Control": "no-store" } });
}
