/** Nation chat rules shared by the web app's API and UI. */
export const CHAT_MAX_LENGTH = 500;
/** Minimum seconds between two messages from the same wallet. */
export const CHAT_COOLDOWN_SEC = 3;
/** How long a chat sign-in lasts. */
export const CHAT_SESSION_TTL_SEC = 7 * 24 * 3600;
/** How old a sign-in signature may be when it is presented. */
export const CHAT_SIGNIN_TTL_SEC = 10 * 60;

/** The exact text a wallet signs once to chat (free, no transaction). */
export function chatSignInMessage(chainId: number, address: string, issuedAt: number): string {
  return [
    "AtlasPad: sign in to nation chat",
    "This signature is free and sends no transaction.",
    `Chain: ${chainId}`,
    `Address: ${address.toLowerCase()}`,
    `Issued at: ${issuedAt}`,
  ].join("\n");
}

/** Trims, strips control characters and collapses blank lines. Returns null when nothing is left or it is too long. */
export function cleanChatMessage(input: string): string | null {
  const body = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!body || body.length > CHAT_MAX_LENGTH) return null;
  return body;
}

export interface ChatMessageDTO {
  id: number;
  author: string;
  body: string;
  createdAt: number;
  /** The author's current share of supply (0..1), or 0 if they no longer hold. */
  share: number;
  isFounder: boolean;
}
