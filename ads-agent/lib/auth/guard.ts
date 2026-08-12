import { NextResponse } from "next/server";
import { assertApplicationDbRole, getPool } from "@/lib/db/client";
import type { Scope } from "@/lib/db/scope-sql";
import { requireApiRole, type MemberRole, type Session } from "./dal";
import { scopeFor } from "./scope";

export type GuardResult =
  | { ok: true; session: Session; scope: Scope }
  | { ok: false; response: NextResponse };

/**
 * Role check plus server-derived scope. The caller never names its own tenant.
 *
 * An org whose kind cannot be read is treated as external, which is the
 * fail-closed reading: the cost of a mistake is a platform user seeing only
 * their own org, not a customer seeing everyone's.
 */
export async function guard(min: MemberRole): Promise<GuardResult> {
  const access = await requireApiRole(min);
  if (!access.ok) return { ok: false, response: access.response };

  if (!access.session.orgId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  await assertApplicationDbRole();
  const { rows } = await getPool().query<{ kind: "internal" | "external" }>(
    `SELECT kind FROM public.orgs WHERE id = $1`,
    [access.session.orgId],
  );
  const orgKind = rows[0]?.kind ?? "external";
  return { ok: true, session: access.session, scope: scopeFor(access.session, orgKind) };
}

/**
 * Loads an entity under scope. A miss returns 404 -- never 403 -- so the
 * response cannot be used to probe whether another tenant's UUID exists.
 */
export async function ownedOr404<T>(
  loader: (scope: Scope) => Promise<T | null>,
  scope: Scope,
): Promise<{ ok: true; entity: T } | { ok: false; response: NextResponse }> {
  const entity = await loader(scope);
  if (!entity) {
    return {
      ok: false,
      response: NextResponse.json({ error: "not found" }, { status: 404 }),
    };
  }
  return { ok: true, entity };
}
