/**
 * Shared cookie attrs for gs_session / gs_refresh.
 * ponytail: Domain=localhost is rejected by browsers; omit Domain on local so the
 * host-only cookie is sent to both :3040 and :3030. Prod uses COOKIE_DOMAIN=.example.com.
 * Secure=false on localhost — http://localhost is not HTTPS; Secure cookies often fail to stick.
 */
export function authCookieBase(
  maxAge: number,
  opts: { shareDomain: boolean },
): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
  domain?: string;
} {
  const raw = process.env.COOKIE_DOMAIN?.trim() || "localhost";
  const isLocal = raw === "localhost";
  return {
    httpOnly: true,
    secure: !isLocal,
    sameSite: "lax",
    path: "/",
    maxAge,
    ...(opts.shareDomain && !isLocal ? { domain: raw } : {}),
  };
}
