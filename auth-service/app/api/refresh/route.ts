import { NextResponse } from "next/server";
import { rotateRefreshToken } from "@/lib/db/refresh-tokens";
import { findUserById } from "@/lib/db/users";
import { getMembership } from "@/lib/db/org-members";
import { mintAccessToken } from "@/lib/jwt";
import { safeReturnTo } from "@/lib/safe-redirect";

function extractRefreshCookie(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)gs_refresh=([^;]+)/);
  return match ? match[1] : null;
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const cookieDomain = process.env.COOKIE_DOMAIN ?? "localhost";
  const returnTo = safeReturnTo(url.searchParams.get("return_to"), url.origin, cookieDomain);
  const loginUrl = new URL(`/login?return_to=${encodeURIComponent(returnTo)}`, url.origin);

  const rawRefresh = extractRefreshCookie(req);
  if (!rawRefresh) return NextResponse.redirect(loginUrl);

  const rotated = await rotateRefreshToken(rawRefresh);
  if (!rotated) return NextResponse.redirect(loginUrl);

  const user = await findUserById(rotated.userId);
  if (!user) return NextResponse.redirect(loginUrl);

  const membership = await getMembership(user.id);
  const accessToken = await mintAccessToken({
    sub: user.id,
    email: user.email,
    orgId: membership?.orgId ?? null,
    role: membership?.role ?? null,
  });

  const res = NextResponse.redirect(returnTo);
  res.cookies.set("gs_session", accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    domain: cookieDomain,
    path: "/",
    maxAge: 20 * 60,
  });
  res.cookies.set("gs_refresh", rotated.newRawToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
