import { NextRequest, NextResponse } from "next/server";

// UX convenience only — NOT the security boundary (see plan's Global Constraints re: CVE-2025-29927).
// Every protected page/action/route still calls requireSession/requireRole/requireApiRole itself.
export function middleware(request: NextRequest): NextResponse {
  if (request.cookies.has("gs_session")) return NextResponse.next();

  const authServiceUrl = process.env.AUTH_SERVICE_URL ?? "http://localhost:3040";
  const returnTo = encodeURIComponent(request.nextUrl.href);
  return NextResponse.redirect(`${authServiceUrl}/login?return_to=${returnTo}`);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
