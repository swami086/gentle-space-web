import { assertApplicationDbRole, getPool } from "@/lib/db/client";
import type { Scope } from "@/lib/db/scope-sql";
import type { Session } from "./dal";

/**
 * Two scopes, derived from the existing orgs.kind column -- no new column, no
 * new concept. orgs.kind already carries CHECK (kind IN ('internal','external'))
 * and the seed row is 'internal', so existing staff keep working through the
 * migration with no data change.
 */
export function scopeFor(session: Session, orgKind: "internal" | "external"): Scope {
  if (!session.orgId) throw new Error("session has no orgId");
  return orgKind === "internal"
    ? { kind: "platform", orgId: session.orgId }
    : { kind: "org", orgId: session.orgId };
}

/** Server components: derive scope from an already-authenticated session. */
export async function scopeFromSession(session: Session): Promise<Scope> {
  if (!session.orgId) throw new Error("session has no orgId");
  await assertApplicationDbRole();
  const { rows } = await getPool().query<{ kind: "internal" | "external" }>(
    `SELECT kind FROM public.orgs WHERE id = $1`,
    [session.orgId],
  );
  return scopeFor(session, rows[0]?.kind ?? "external");
}
