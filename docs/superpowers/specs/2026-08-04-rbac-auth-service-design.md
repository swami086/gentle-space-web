# RBAC + Google SSO for the admin portal, via a separate auth-service

Date: 2026-08-04
Status: approved (pending user review of this written spec)
Related: supersedes the "Real authentication" non-goal in
[`docs/superpowers/specs/2026-08-04-token-credit-accounting-design.md`](2026-08-04-token-credit-accounting-design.md)
(that spec's `orgs`/`users` tables and `lib/metering/dev-context.ts` dev stand-ins are the identity
model this spec replaces with a real, verified session), and builds on the same admin dashboard from
[`docs/superpowers/specs/2026-08-03-ads-agent-admin-dashboard-design.md`](2026-08-03-ads-agent-admin-dashboard-design.md).

## Problem

`ads-agent`'s admin portal (`app/(admin)/*` — Overview, Campaigns, Proposals, Settings, and the new
Usage & Credits page) is **completely unauthenticated** today. Anyone who can reach the deployed URL
can allocate credits, edit campaign settings, and approve proposals. Before this goes further, the
admin portal needs real login (Google SSO only, for now) and role-based access control, and — per
explicit product direction — that identity/access system should live in its own service with its own
database, not be bolted onto `ads-agent`'s existing Postgres, so it can be reused by other logged-in
products later (the same "future logged-in products" scope named in the credit-accounting spec).

## Goals

1. A new **`auth-service`** — its own deployable Next.js app, its own Postgres database (`auth_db`) —
   is the source of truth for identity (who is this person) and access (what role do they hold).
2. The only login method is **Google** (OAuth 2.0 / OIDC via Auth.js). No passwords are ever stored.
3. **Deny-by-default RBAC**: any Gmail account can authenticate, but a brand-new account has no role
   and no data access until an existing admin grants one, except for a one-time bootstrap allowlist
   that seeds the very first admin.
4. Three fixed, global roles: **admin** (everything, including credits/settings/user management),
   **operator** (campaigns/proposals), **viewer** (read-only dashboards).
5. `ads-agent` becomes a resource server: it verifies the session locally (no network call per
   request) and enforces roles in its Data Access Layer, not in `middleware.ts` — see Security.
6. Both services are exposed under real subdomains of `gentlespacesolutions.com`
   (`auth.gentlespacesolutions.com`, `ads.gentlespacesolutions.com`) behind the existing Caddy
   instance, since Google's OAuth redirect URI needs a stable public host anyway.

## Non-goals (this phase)

- **Tenant-customizable roles / role templates.** The three roles are fixed and global. This is an
  internal admin tool, not a self-serve product where external customers define their own role
  taxonomy — that WorkOS-style "hybrid templates" pattern is explicitly not needed here.
- **Multi-org membership / org-switcher.** A user belongs to at most one org (`org_members` has one
  row per user for v1). Nothing blocks adding this later; it's just not built speculatively.
- **Any login method other than Google.** No email/password, no other social providers.
- **MFA / passkeys.** Google's own account security is the upstream factor here.
- **SCIM / directory sync / enterprise IdP group→role mapping.** Roles are assigned manually by an
  admin through the UI.
- **Automated JWT signing-key rotation.** One RS256 keypair via env vars for v1; rotation is a manual
  runbook step, documented but not automated.
- **Bringing the main `GentleSpace_Web` site or Twenty CRM onto this auth-service.** The design is
  meant to make that straightforward later (it's a generic OIDC-client + JWKS resource-server
  pattern), but only `ads-agent` is wired up now.
- **A full BFF proxy in front of `ads-agent`.** Rejected as overkill for a single first-party consumer
  app — see Approaches considered.

## Approaches considered

| Option | Trade-off |
|---|---|
| **Signed JWT (RS256) over a shared-domain cookie, verified via JWKS (chosen)** | `auth-service` mints a short-lived signed JWT and sets it as a cookie on `.gentlespacesolutions.com`; `ads-agent` verifies it locally against a cached public key from `auth-service`'s JWKS endpoint. No shared secret, no network call per request, and it's the standard IAM/resource-server shape — trivially extends to another consumer service or a mobile client later. |
| Shared-secret symmetric session cookie | `auth-service` and `ads-agent` share one `AUTH_SECRET` to decrypt the same encrypted session cookie. Less code, but couples the two services by a symmetric secret (rotating it means redeploying both) and doesn't generalize to a client that shouldn't hold the signing secret (e.g. a future mobile app or third-party integration). |
| Full BFF proxy (`auth-service` fronts all `ads-agent` traffic) | The textbook pattern for many resource servers behind one gateway. Rejected: exactly one consumer app exists today, and this would mean re-routing all of `ads-agent`'s routing through a proxy — not justified by current scope (YAGNI). |

## Architecture

```
Browser
  │ 1. GET ads.gentlespacesolutions.com/(admin)/* — no/expired gs_session cookie
  ▼
ads-agent (resource server, unchanged app, now on ads.gentlespacesolutions.com)
  │ DAL redirects to auth-service with return_to
  ▼
auth-service (NEW app, auth.gentlespacesolutions.com, own Postgres "auth_db")
  │ Auth.js + Google provider → Google OIDC code flow
  │ on success: look up/create user by google_sub, check org_members for a role
  │ mints short-lived RS256 JWT {sub, email, org_id, role, exp}
  │ exposes GET /.well-known/jwks.json (public key only)
  ▼
Sets gs_session (JWT, Domain=.gentlespacesolutions.com, httpOnly/Secure/SameSite=Lax, ~20 min)
  + gs_refresh (rotating opaque token, httpOnly, host-only to auth-service, ~30 days)
  │ redirect back to validated return_to
  ▼
ads-agent verifies gs_session locally via cached JWKS (no network call), JIT-provisions a local
shadow users/orgs row (same UUID as auth-service's canonical ids), enforces role in its DAL.
```

`auth-service/` sits alongside `ads-agent/` at the repo root as its own independently deployable app —
same pattern the repo already uses (`ads-agent` is its own Next.js app + own Postgres, reverse-proxied
by the shared Caddy instance).

## Data model — `auth-service`'s own database (`auth_db`)

`auth-service` owns identity, org membership, and role — the entire "who is this and what can they
do" domain:

```sql
CREATE TABLE orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'external' CHECK (kind IN ('internal','external')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  google_sub TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TYPE member_role AS ENUM ('admin', 'operator', 'viewer');

-- Absence of a row here for a given user = "pending": logged in, no access yet.
CREATE TABLE org_members (
  org_id UUID NOT NULL REFERENCES orgs(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role member_role NOT NULL,
  invited_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id),
  UNIQUE (user_id) -- v1: at most one org per user
);

-- Rotating refresh tokens for silent re-issuance of the short-lived JWT.
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL, -- sha256; the raw token is never stored
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed: reuse the same "Gentle Space (internal)" org UUID already seeded by the credit-ledger work,
-- so ads-agent's existing org_balances row lines up with this org from day one.
INSERT INTO orgs (id, name, kind) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Gentle Space (internal)', 'internal')
ON CONFLICT (id) DO NOTHING;
```

`ads-agent`'s existing `orgs`/`users` tables (created for the credit ledger) stop being authoritative
for identity. They become a **local shadow/cache**, JIT-populated with the *same* UUIDs the first time
`ads-agent` sees a verified token for a given `sub`/`org_id`, so `org_balances` / `user_balances` /
`usage_ledger` foreign keys keep working unchanged. `ads-agent` never queries `auth_db` directly for
these — only the JWT claims and the one internal API below.

## Auth flow

1. `ads-agent`'s DAL finds no valid `gs_session` cookie (or an expired one) → redirect to
   `auth-service`'s login page with a `return_to` query param.
2. `auth-service` runs Google's OAuth 2.0 / OIDC code flow through Auth.js's Google provider.
3. On the Auth.js callback: look up the user by `google_sub`; create the `users` row if new (a new
   user has **no** `org_members` row → pending, no role). Update `last_login_at`.
4. **Bootstrap admin**: an `ADMIN_BOOTSTRAP_EMAILS` env allowlist is checked *only* the first time a
   given email is ever seen — a match auto-creates an `org_members` row with `role = 'admin'` in the
   internal org. Every role change after that happens through the admin UI (see below), never by
   editing env vars again.
5. `auth-service` mints an RS256 JWT: `{ sub: user.id, email, org_id, role, iat, exp }` (`role`/`org_id`
   omitted if the user is pending), ~20 minute expiry.
6. Sets two cookies: `gs_session` (the JWT itself, `Domain=.gentlespacesolutions.com`, httpOnly,
   Secure, `SameSite=Lax`) and `gs_refresh` (opaque, rotating, hashed server-side in
   `refresh_tokens`, host-only to `auth.gentlespacesolutions.com`, ~30 days).
7. Redirects to the validated `return_to` — relative-path only, rejecting absolute/external URLs, per
   the standard open-redirect guard.
8. When `gs_session` expires, `ads-agent` redirects the browser to `auth-service`'s silent-refresh
   route; since the browser still holds `gs_refresh` there, a new JWT is minted without re-prompting
   Google (unless `gs_refresh` has also expired/been revoked, in which case it's a full login again).

## RBAC enforcement in `ads-agent`

- `lib/auth/dal.ts`: `requireSession()` verifies the JWT signature (via `jose`, using the public key
  fetched once from `auth-service`'s `/.well-known/jwks.json` and cached in-process) and its `exp`.
  `requireRole(minRole)` additionally checks role against the hierarchy `admin > operator > viewer`.
  Both are called at the top of every protected server component, route handler, and server action —
  never relied on via `middleware.ts` alone (see Security).
- `middleware.ts` does a cheap "is there a plausible session cookie" check purely for UX redirects to
  the login page; it is not a security boundary.
- Route/action guards:
  - `/credits`, `/settings`, `/(admin)/users` → **admin** only.
  - `/campaigns`, `/proposals` (create/edit/approve) → **operator** or above.
  - Dashboards / read-only views → **viewer** or above.
  - No role assigned (pending) → an "your account is pending approval" page, no data access at all.
- `lib/metering/dev-context.ts`'s `DEFAULT_ORG_ID`/`DEFAULT_USER_ID` stand-ins are replaced by the
  real `orgId`/`userId` from the verified session everywhere they're currently used
  (`campaign-chat.ts`, the credits grant route, etc.).
- New `/(admin)/users` page (admin-only): lists org members (email, name, role, last login) and
  pending users (logged in, no role yet), with an "assign/change role" action. This is the one place
  `ads-agent` calls into `auth-service`, via a small internal API (`POST /internal/org-members`)
  guarded by a shared `INTERNAL_API_KEY` header — not a user JWT, since it's a service-to-service
  mutation of `auth-service`'s own database.

## Deployment

- New `auth-service/` app: own `package.json`, own Postgres container (`auth-db`), following the same
  shape as `ads-agent/` (`lib/db/client.ts`, `lib/db/schema.sql`, `lib/db/migrate.ts`).
- Caddy (`deploy/Caddyfile`): add
  `auth.gentlespacesolutions.com { reverse_proxy auth:3040 }` and
  `ads.gentlespacesolutions.com { reverse_proxy ads-agent:3030 }` — the latter makes `ads-agent`
  publicly reachable for the first time; it's currently not in the Caddyfile at all.
- `deploy/docker-compose.prod.yml`: add `auth` and `auth-db` services alongside the existing `caddy`
  service definition.
- One Google Cloud OAuth 2.0 Client (Web application), authorized redirect URI
  `https://auth.gentlespacesolutions.com/api/auth/callback/google`.
- New env vars — `auth-service`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET` (Auth.js's
  own cookie encryption, separate from the RS256 signing pair below), `AUTH_JWT_PRIVATE_KEY`,
  `AUTH_JWT_PUBLIC_KEY`, `AUTH_JWT_KID`, `ADMIN_BOOTSTRAP_EMAILS`, `COOKIE_DOMAIN`,
  `DATABASE_URL` (`auth_db`). `ads-agent` additions: `AUTH_SERVICE_URL`,
  `AUTH_SERVICE_JWKS_URL`, `AUTH_SERVICE_INTERNAL_API_KEY`.

## Security

- httpOnly + Secure + `SameSite=Lax` on both cookies; JWT never touches `localStorage` or JS-readable
  storage.
- Short JWT lifetime (~20 min) bounds the blast radius of a leaked token; `gs_refresh` is rotated on
  every use and hashed at rest, so a single stolen refresh token is revocable and single-use.
- **Middleware is not the security boundary** (Next.js `middleware.ts` had a real header-based
  bypass — CVE-2025-29927 — that skipped middleware logic entirely). `middleware.ts` here only
  redirects for UX; `requireSession()`/`requireRole()` in the DAL, called explicitly in every
  handler/action/server component that touches protected data, is the actual enforcement.
- Correct status codes: no session → `401`; valid session, insufficient role → `403`.
- Login/callback routes are rate-limited (simple in-process sliding-window limiter keyed by IP; no new
  infra dependency introduced for this, since nothing in the repo currently uses Redis).
- `return_to` / redirect targets are validated as relative paths only — no open redirects.
- No passwords are ever stored, so there's no password-reset or credential-stuffing surface for this
  service.

## Testing

- **Unit** (`auth-service`): JWT verification (valid / expired / tampered signature / wrong issuer),
  bootstrap-email matching, JIT user creation, refresh-token rotation and hash comparison.
- **Unit** (`ads-agent`): `requireRole` hierarchy logic, JIT-provisioning upsert of the local
  shadow `users`/`orgs` rows, 401-vs-403 behavior for each route guard.
- **Manual smoke** (real Google OAuth can't be meaningfully automated end-to-end): sign in with a
  bootstrap email → lands as admin; sign in with a non-bootstrap email → lands on the "pending"
  page; admin assigns `operator` role to the pending user from `/users` → that user refreshes their
  session → can reach `/campaigns` but gets `403` on `/credits` and `/settings`.

## Success criteria

- `auth-service` is deployed at `auth.gentlespacesolutions.com` with its own Postgres, and Google
  Sign-In works end-to-end.
- `ads-agent` is deployed at `ads.gentlespacesolutions.com`, verifies sessions locally via JWKS, and
  every previously-open admin route now requires the correct role.
- A brand-new Gmail login with no role sees a "pending approval" screen and can access no data.
- The `ADMIN_BOOTSTRAP_EMAILS` allowlist successfully seeds exactly one admin on first login; all
  further role changes happen through `/(admin)/users`, not env edits.
- `npm test` and `npm run lint` pass with no new warnings in both `auth-service/` and `ads-agent/`.

## Implementation order (high level)

1. `auth-service` schema + migration (`orgs`, `users`, `org_members`, `refresh_tokens`), independent
   of everything else.
2. `auth-service` Auth.js + Google provider wiring, JIT user creation, bootstrap-admin-email logic.
3. `auth-service` JWT minting (RS256) + `/.well-known/jwks.json` + refresh endpoint.
4. `ads-agent`'s `lib/auth/dal.ts` (`requireSession`, `requireRole`) using `jose` against the cached
   JWKS key; `middleware.ts` UX redirect.
5. Wire route/action guards across `ads-agent`'s admin pages; replace `dev-context.ts` stand-ins with
   real session values.
6. `auth-service` internal API (`POST /internal/org-members`) + `ads-agent`'s new `/(admin)/users`
   page calling it.
7. Caddy + docker-compose changes to expose both services publicly; Google Cloud OAuth client setup
   (manual, documented as a runbook step).
