import { NextRequest, NextResponse } from "next/server";

// UX convenience only — NOT the security boundary (see plan's Global Constraints re: CVE-2025-29927).
// Every protected page/action/route still calls requireSession/requireRole/requireApiRole itself.

/** Public origin for return_to — behind Caddy, nextUrl.origin is the internal container host. */
function publicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  const adsApp = process.env.ADS_APP_URL?.trim().replace(/\/$/, "");
  if (adsApp) return adsApp;
  return request.nextUrl.origin;
}

export function middleware(request: NextRequest): NextResponse {
  if (request.cookies.has("gs_session")) return NextResponse.next();

  const authServiceUrl = process.env.AUTH_SERVICE_URL ?? "http://localhost:3040";
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, publicOrigin(request));
  const returnTo = encodeURIComponent(target.href);
  return NextResponse.redirect(`${authServiceUrl}/login?return_to=${returnTo}`);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
