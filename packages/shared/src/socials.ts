/**
 * Nation social links. They are off-chain profile data, set by the nation's founder with a signed message,
 * and every value is normalised to one canonical https URL so the UI never renders arbitrary links.
 */
export interface NationSocials {
  x: string;
  telegram: string;
  website: string;
}

export const EMPTY_SOCIALS: NationSocials = { x: "", telegram: "", website: "" };

/** How long a signed socials update stays valid. */
export const SOCIALS_SIGNATURE_TTL_SEC = 15 * 60;

const HANDLE = /^[A-Za-z0-9_]{1,32}$/;

/** "@name", "name", "x.com/name" or "https://twitter.com/name" → "https://x.com/name". Returns null if invalid. */
export function normalizeX(input: string): string | null {
  const v = input.trim();
  if (!v) return "";
  const m = v.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,32})\/?(?:[?#].*)?$/i) ?? v.match(/^@?([A-Za-z0-9_]{1,32})$/);
  return m && HANDLE.test(m[1]!) ? `https://x.com/${m[1]}` : null;
}

/** "@group", "group", "t.me/group" or "https://telegram.me/group" → "https://t.me/group". Returns null if invalid. */
export function normalizeTelegram(input: string): string | null {
  const v = input.trim();
  if (!v) return "";
  const m = v.match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(\+?[A-Za-z0-9_]{3,64})\/?$/i) ?? v.match(/^@?([A-Za-z0-9_]{3,64})$/);
  return m ? `https://t.me/${m[1]}` : null;
}

/** Any http(s) URL with a real hostname → its https form, without credentials. Returns null if invalid. */
export function normalizeWebsite(input: string): string | null {
  let v = input.trim();
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return null;
    u.protocol = "https:";
    const s = u.toString();
    return s.length <= 200 ? s.replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

/** Normalise all three, or report which field is invalid. */
export function normalizeSocials(input: Partial<NationSocials>): { ok: true; socials: NationSocials } | { ok: false; field: keyof NationSocials } {
  const x = normalizeX(input.x ?? "");
  if (x === null) return { ok: false, field: "x" };
  const telegram = normalizeTelegram(input.telegram ?? "");
  if (telegram === null) return { ok: false, field: "telegram" };
  const website = normalizeWebsite(input.website ?? "");
  if (website === null) return { ok: false, field: "website" };
  return { ok: true, socials: { x, telegram, website } };
}

/** The exact text the founder signs. Server and client must build it identically. */
export function socialsMessage(chainId: number, nationId: number, s: NationSocials, issuedAt: number): string {
  return [
    "AtlasPad: update nation social links",
    `Chain: ${chainId}`,
    `Nation: ${nationId}`,
    `X: ${s.x || "-"}`,
    `Telegram: ${s.telegram || "-"}`,
    `Website: ${s.website || "-"}`,
    `Issued at: ${issuedAt}`,
  ].join("\n");
}
