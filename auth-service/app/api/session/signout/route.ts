import { NextResponse } from "next/server";
import { signOut } from "@/auth";
import { revokeRefreshToken } from "@/lib/db/refresh-tokens";
import { safeReturnTo } from "@/lib/safe-redirect";

function extractRefreshCookie(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)gs_refresh=([^;]+)/);
  return match ? match[1] : null;
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const cookieDomain = process.env.COOKIE_DOMAIN ?? "localhost";
  const destination = safeReturnTo(url.searchParams.get("return_to"), url.origin, cookieDomain);

  const rawRefresh = extractRefreshCookie(req);
  if (rawRefresh) await revokeRefreshToken(rawRefresh);

  // redirect: false — this is a plain Route Handler, not a Server Action; we build our own
  // NextResponse below. signOut() still clears Auth.js's own session cookie via next/headers,
  // which Route Handlers (like Server Actions) can mutate for the response being built.
  await signOut({ redirect: false });

  const res = NextResponse.redirect(destination);
  res.cookies.set("gs_refresh", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
