import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { findOrCreateUserByGoogle, touchLastLogin } from "@/lib/db/users";
import { getMembership, upsertMembership, INTERNAL_ORG_ID } from "@/lib/db/org-members";
import { createRefreshToken } from "@/lib/db/refresh-tokens";
import { mintAccessToken } from "@/lib/jwt";
import { safeReturnTo } from "@/lib/safe-redirect";
import { checkRateLimit } from "@/lib/rate-limit";
import { authCookieBase } from "@/lib/cookies";

function bootstrapEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_BOOTSTRAP_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);

  // Global Constraints: login/callback rate limiter (in-memory; see rate-limit.ts ponytail).
  if (!checkRateLimit(`bridge:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await auth();

  if (!session?.googleSub || !session.user?.email) {
    return NextResponse.redirect(new URL("/login", url));
  }

  const user = await findOrCreateUserByGoogle({
    googleSub: session.googleSub,
    email: session.user.email,
    name: session.user.name ?? null,
    avatarUrl: session.user.image ?? null,
  });
  await touchLastLogin(user.id);

  let membership = await getMembership(user.id);
  if (!membership && bootstrapEmails().has(user.email.toLowerCase())) {
    await upsertMembership({ orgId: INTERNAL_ORG_ID, userId: user.id, role: "admin", invitedBy: null });
    membership = { orgId: INTERNAL_ORG_ID, role: "admin" };
  }

  const accessToken = await mintAccessToken({
    sub: user.id,
    email: user.email,
    orgId: membership?.orgId ?? null,
    role: membership?.role ?? null,
  });
  const refreshToken = await createRefreshToken(user.id);

  const cookieDomain = process.env.COOKIE_DOMAIN ?? "localhost";
  const destination = safeReturnTo(url.searchParams.get("return_to"), url.origin, cookieDomain);
  const isLocal = cookieDomain === "localhost" || cookieDomain === "127.0.0.1";

  // Local: hand the access token to ads-agent so it can Set-Cookie on :3030.
  // Shared Domain cookies work in prod; Cursor's browser often drops cross-port Set-Cookie.
  if (isLocal) {
    const adsBase = process.env.ADS_APP_URL?.trim() || "http://localhost:3030/";
    const accept = new URL("/api/auth/accept", adsBase);
    accept.searchParams.set("gs_session", accessToken);
    accept.searchParams.set("return_to", destination);
    const res = NextResponse.redirect(accept.toString());
    res.cookies.set("gs_refresh", refreshToken, authCookieBase(60 * 60 * 24 * 30, { shareDomain: false }));
    return res;
  }

  const res = NextResponse.redirect(destination);
  res.cookies.set("gs_session", accessToken, authCookieBase(20 * 60, { shareDomain: true }));
  // Refresh stays host-only on auth-service (shareDomain: false).
  res.cookies.set("gs_refresh", refreshToken, authCookieBase(60 * 60 * 24 * 30, { shareDomain: false }));
  return res;
}
