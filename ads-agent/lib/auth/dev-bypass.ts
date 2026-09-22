import type { Session } from "./dal";

/**
 * Local-only auth bypass so the admin UI is reachable without Google OAuth.
 * Requires AUTH_BYPASS=1|true AND NODE_ENV !== "production". Never enable in prod.
 */
export function isAuthBypassEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const raw = process.env.AUTH_BYPASS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

const SEED_PLATFORM_ORG = "00000000-0000-0000-0000-000000000001";
/** Stable UUID — users.id is uuid; string ids break ensureShadowRows. */
const BYPASS_USER_ID = "00000000-0000-4000-8000-0000000000de";

export function bypassSession(): Session {
  const orgId = process.env.PLATFORM_ORG_ID?.trim() || SEED_PLATFORM_ORG;
  return {
    userId: BYPASS_USER_ID,
    email: process.env.AUTH_BYPASS_EMAIL?.trim() || "dev@localhost",
    orgId,
    role: "admin",
  };
}
