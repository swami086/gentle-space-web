import type { Scope } from "../db/scope-sql";

/** Platform org as org scope — inbound webhooks and worker writes run under this tenant. */
export function platformOrgScope(env: NodeJS.ProcessEnv = process.env): Scope {
  const orgId = env.PLATFORM_ORG_ID?.trim();
  if (!orgId) throw new Error("PLATFORM_ORG_ID is not set");
  return { kind: "org", orgId };
}
