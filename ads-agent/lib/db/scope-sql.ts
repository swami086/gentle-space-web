/**
 * Two scopes, derived from the existing orgs.kind column. No new column, no new
 * concept (tenancy spec §1).
 *
 * Platform scope is a read affordance, not a write bypass: the RLS policy grants
 * it cross-org visibility in USING only, and WITH CHECK still pins every write
 * to public.current_tenant().
 */
export type Scope =
  | { kind: "platform"; orgId: string } // Gentle Space staff; may read across orgs
  | { kind: "org"; orgId: string }; //     external customer; hard-bounded to orgId

/**
 * SQL fragment plus params constraining a query to the caller's scope.
 *
 * Calling convention, and it is load-bearing: the fragment always consumes
 * exactly one placeholder, $1, in both branches, so a caller spreads
 * scope.params first and numbers its own params from $2 whatever the scope kind.
 * A branch emitting zero params would shift every later placeholder depending on
 * who was calling, which is a bug factory.
 */
export function scopeClause(
  scope: Scope,
  column = "org_id",
): { sql: string; params: unknown[] } {
  if (scope.kind === "platform") {
    // Always true for a non-null orgId, which Scope guarantees. Present only to
    // keep the placeholder count identical to the org branch.
    return { sql: "$1::uuid IS NOT NULL", params: [scope.orgId] };
  }
  return { sql: `${column} = $1::uuid`, params: [scope.orgId] };
}
