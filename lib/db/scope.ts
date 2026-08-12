/**
 * The same Scope the ads-agent app uses (ads-agent/lib/db/scope-sql.ts).
 * Duplicated deliberately: the two apps have separate package.json files, pools
 * and deployments, with no shared package — the same intentional duplication as
 * the AUTH_ISSUER literal in ads-agent/lib/auth/dal.ts. The shared contract is
 * the SQL, and RLS is what enforces it.
 */
export type Scope =
  | { kind: "platform"; orgId: string }
  | { kind: "org"; orgId: string };
