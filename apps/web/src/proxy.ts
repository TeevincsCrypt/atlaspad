import { NextResponse, type NextRequest } from "next/server";
import { adminConfigured, isAdminAuthorized } from "./lib/admin-auth";

/** Protects the internal admin dashboard and its API with HTTP Basic auth. */
export function proxy(req: NextRequest) {
  if (!adminConfigured()) return new NextResponse("Not found", { status: 404 });
  if (!isAdminAuthorized(req.headers.get("authorization"))) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="AtlasPad admin", charset="UTF-8"', "Cache-Control": "no-store" },
    });
  }
  const res = NextResponse.next();
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Robots-Tag", "noindex");
  return res;
}

export const config = { matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"] };
