import { orgScopeFromSession } from "../attribution/org-scope";
import { getSession } from "../auth/dal";
import type { Scope } from "../db/scope-sql";

/** Takes no arguments on purpose: the model must never be able to name its own tenant
 *  (data model §5). Always org scope — a generative surface does not read across orgs. */
export async function toolScope(): Promise<Scope> {
  const session = await getSession();
  if (!session) throw new Error("no session: analytics tools cannot run unauthenticated");
  return orgScopeFromSession(session);
}
