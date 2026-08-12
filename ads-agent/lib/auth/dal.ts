import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { NextResponse } from "next/server";
import { getPool } from "../db/client";

// This literal MUST match the AUTH_ISSUER constant in auth-service/lib/jwt.ts exactly — there is no
// shared package between the two services, so this is intentional duplication (see plan's Global
// Constraints).
const AUTH_ISSUER = "gentlespace-auth-service";

export type MemberRole = "admin" | "operator" | "viewer";
export type Session = { userId: string; email: string; orgId: string | null; role: MemberRole | null };

export const ROLE_RANK: Record<MemberRole, number> = { viewer: 1, operator: 2, admin: 3 };

function authServiceUrl(): string {
  const url = process.env.AUTH_SERVICE_URL;
  if (!url) throw new Error("AUTH_SERVICE_URL is not set");
  return url;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL("/.well-known/jwks.json", authServiceUrl()));
  return jwks;
}

/**
 * ponytail: upserts the shadow orgs/users rows on every verified request rather than once per
 * session. Ceiling: one extra idempotent upsert per request. Upgrade path: skip it when a
 * short-lived in-memory "already provisioned this userId" set says it's redundant — not worth the
 * complexity at current admin-portal traffic levels.
 */
async function ensureShadowRows(session: Session): Promise<void> {
  if (!session.orgId) return; // pending users have no org yet, nothing to shadow
  await getPool().query(
    `INSERT INTO orgs (id, name, kind) VALUES ($1, 'Gentle Space (internal)', 'internal')
     ON CONFLICT (id) DO NOTHING`,
    [session.orgId],
  );
  await getPool().query(
    `INSERT INTO users (id, org_id, email, display_name, role)
     VALUES ($1, $2, $3, $3, 'viewer')
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
    [session.userId, session.orgId, session.email],
  );
  await getPool().query(
    `INSERT INTO adsagent.org_cron_settings (org_id) VALUES ($1)
     ON CONFLICT (org_id) DO NOTHING`,
    [session.orgId],
  );
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get("gs_session")?.value;
  if (!token) return null;

  let session: Session;
  try {
    const { payload } = await jwtVerify(token, getJwks(), { issuer: AUTH_ISSUER });
    session = {
      userId: String(payload.sub),
      email: String(payload.email ?? ""),
      orgId: typeof payload.orgId === "string" ? payload.orgId : null,
      role: typeof payload.role === "string" ? (payload.role as MemberRole) : null,
    };
  } catch (err) {
    console.error("[auth/dal] jwtVerify failed:", err instanceof Error ? err.message : err);
    return null;
  }

  // Shadow upsert must not look like logout — JWT already proved the session.
  try {
    await ensureShadowRows(session);
  } catch (err) {
    console.error("[auth/dal] ensureShadowRows failed:", err instanceof Error ? err.message : err);
  }
  return session;
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(`${authServiceUrl()}/login`);
  return session;
}

export type RoleCheckResult =
  | { ok: true; session: Session }
  | { ok: false; session: Session | null; reason: "unauthenticated" | "forbidden" };

export async function requireRole(min: MemberRole): Promise<RoleCheckResult> {
  const session = await getSession();
  if (!session) return { ok: false, session: null, reason: "unauthenticated" };
  if (!session.role || ROLE_RANK[session.role] < ROLE_RANK[min]) {
    return { ok: false, session, reason: "forbidden" };
  }
  return { ok: true, session };
}

export type ApiRoleCheckResult = { ok: true; session: Session } | { ok: false; response: NextResponse };

export async function requireApiRole(min: MemberRole): Promise<ApiRoleCheckResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!session.role || ROLE_RANK[session.role] < ROLE_RANK[min]) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, session };
}
