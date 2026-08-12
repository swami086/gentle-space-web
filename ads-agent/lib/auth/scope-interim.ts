import { getPool } from "@/lib/db/client";
import type { Scope } from "@/lib/db/scope-sql";
import type { Session } from "./dal";

/**
 * Interim scope derivation for S3-B. Task 17 replaces every caller with
 * `guard`, which returns the same Scope alongside the role check, and deletes
 * this file. It exists so seven parallel branches derive scope identically
 * rather than seven slightly different ways.
 */
export async function scopeForSession(session: Session): Promise<Scope> {
  if (!session.orgId) throw new Error("session has no orgId");
  const { rows } = await getPool().query<{ kind: "internal" | "external" }>(
    `SELECT kind FROM public.orgs WHERE id = $1`,
    [session.orgId],
  );
  const kind = rows[0]?.kind ?? "external";
  return kind === "internal"
    ? { kind: "platform", orgId: session.orgId }
    : { kind: "org", orgId: session.orgId };
}

/**
 * Scope for a background job that has no session: the decision cycle, the
 * executor, and the MCP servers. Each runs for exactly one org, named by the
 * caller -- never inferred, and never platform.
 */
export function scopeForJob(orgId: string): Scope {
  return { kind: "org", orgId };
}
