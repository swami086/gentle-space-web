import type { Session } from "../auth/dal";
import type { Scope } from "../db/scope-sql";

/** Attribution surfaces read one org's numbers and never span orgs. Cross-org analytics is
 *  the privileged audited path (datastore spec §5.1) and the staff query layer at S11 —
 *  not this function. */
export function orgScopeFromSession(session: Session): Scope {
  if (!session.orgId) {
    throw new Error("session has no org: cannot read attribution without a tenant");
  }
  return { kind: "org", orgId: session.orgId };
}
