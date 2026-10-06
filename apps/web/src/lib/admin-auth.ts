/** HTTP Basic auth for the internal admin dashboard. Disabled (404) unless ADMIN_USERNAME and ADMIN_PASSWORD are set. */
let warned = false;

export function adminConfigured(): boolean {
  const { ADMIN_USERNAME: user, ADMIN_PASSWORD: pass } = process.env;
  if (user && pass && pass.length < 12 && !warned) {
    warned = true;
    console.warn("Admin dashboard disabled: ADMIN_PASSWORD must be at least 12 characters.");
  }
  return Boolean(user && pass && pass.length >= 12);
}

function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function isAdminAuthorized(authorization: string | null): boolean {
  if (!adminConfigured() || !authorization?.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = atob(authorization.slice(6));
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return safeEqual(user, process.env.ADMIN_USERNAME!) && safeEqual(pass, process.env.ADMIN_PASSWORD!);
}
