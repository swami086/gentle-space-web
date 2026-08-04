// No auth system exists yet (see docs/superpowers/specs/2026-08-04-token-credit-accounting-design.md
// Non-goals). Every metered call runs as this one fixed dev org/user, seeded in schema.sql, until a
// real login flow replaces this with the actual authenticated caller.
export const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
export const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000002";
