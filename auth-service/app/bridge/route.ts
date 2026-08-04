import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { findOrCreateUserByGoogle, touchLastLogin } from "@/lib/db/users";
import { getMembership, upsertMembership, INTERNAL_ORG_ID } from "@/lib/db/org-members";
import { createRefreshToken } from "@/lib/db/refresh-tokens";
import { mintAccessToken } from "@/lib/jwt";
import { safeReturnTo } from "@/lib/safe-redirect";

function bootstrapEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_BOOTSTRAP_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
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

  const res = NextResponse.redirect(destination);
  res.cookies.set("gs_session", accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    domain: cookieDomain,
    path: "/",
    maxAge: 20 * 60,
  });
  res.cookies.set("gs_refresh", refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
