import { NextResponse } from "next/server";
import { jwtVerify, createRemoteJWKSet } from "jose";

// Must match auth-service / ads-agent dal issuer.
const AUTH_ISSUER = "gentlespace-auth-service";

function authServiceUrl(): string {
  const url = process.env.AUTH_SERVICE_URL;
  if (!url) throw new Error("AUTH_SERVICE_URL is not set");
  return url;
}

function adsOrigin(): string {
  return process.env.ADS_APP_URL?.trim() || "http://localhost:3030";
}

/**
 * Local-dev cookie handoff: auth-service cannot reliably set a cookie that Cursor's
 * embedded browser (and some Chromium builds) will send to a different port.
 * Bridge redirects here with ?gs_session=…; we set the cookie on :3030 then bounce.
 * ponytail: token briefly appears in the URL — local-only; prod uses Domain-shared cookies.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const token = url.searchParams.get("gs_session");
  const returnToRaw = url.searchParams.get("return_to") || "/";

  const login = new URL("/login", authServiceUrl());
  if (!token) {
    return NextResponse.redirect(login);
  }

  try {
    const jwks = createRemoteJWKSet(new URL("/.well-known/jwks.json", authServiceUrl()));
    await jwtVerify(token, jwks, { issuer: AUTH_ISSUER });
  } catch (err) {
    console.error("[auth/accept] invalid gs_session:", err instanceof Error ? err.message : err);
    return NextResponse.redirect(login);
  }

  let destination: URL;
  try {
    destination = new URL(returnToRaw, adsOrigin());
  } catch {
    destination = new URL("/", adsOrigin());
  }
  if (destination.hostname !== "localhost" && destination.hostname !== "127.0.0.1") {
    destination = new URL("/", adsOrigin());
  }

  const res = NextResponse.redirect(destination);
  res.cookies.set("gs_session", token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 20 * 60,
  });
  return res;
}
