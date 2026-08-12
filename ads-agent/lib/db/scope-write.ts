import type { Scope } from "./scope-sql";

/**
 * Every enquiry-spine row belongs to exactly one org, so a platform-scoped
 * caller has no org to write under. Refusing here rather than defaulting keeps
 * a staff tool from silently attributing a broker's enquiry to nobody.
 */
export function orgIdForWrite(scope: Scope): string {
  if (scope.kind !== "org") {
    throw new Error("orgIdForWrite: platform scope cannot write tenant rows");
  }
  return scope.orgId;
}
