import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { CHAT_SESSION_TTL_SEC } from "@atlaspad/shared";

export const CHAT_COOKIE = "atlas_chat";

/**
 * Chat sessions are stateless signed cookies: "<address>.<expiry>.<hmac>". The key is CHAT_SESSION_SECRET, or, when
 * that is not set, derived from DATABASE_URL (already a server-only secret), so no new variable is required.
 */
function key(): Buffer | null {
  const secret = process.env.CHAT_SESSION_SECRET || process.env.DATABASE_URL;
  return secret ? createHash("sha256").update(`atlaspad-chat:${secret}`).digest() : null;
}

const mac = (k: Buffer, payload: string) => createHmac("sha256", k).update(payload).digest("base64url");

export function issueChatToken(address: string, now = Math.floor(Date.now() / 1000)): string | null {
  const k = key();
  if (!k) return null;
  const payload = `${address.toLowerCase()}.${now + CHAT_SESSION_TTL_SEC}`;
  return `${payload}.${mac(k, payload)}`;
}

/** The signed-in address, or null for a missing, expired or forged token. */
export function readChatToken(token: string | undefined | null, now = Math.floor(Date.now() / 1000)): string | null {
  const k = key();
  if (!k || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [address, exp, sig] = parts as [string, string, string];
  if (!/^0x[0-9a-f]{40}$/.test(address) || !/^\d+$/.test(exp) || Number(exp) < now) return null;
  const want = Buffer.from(mac(k, `${address}.${exp}`));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? address : null;
}

export function chatCookieFrom(req: Request): string | null {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${CHAT_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]!) : null;
}
