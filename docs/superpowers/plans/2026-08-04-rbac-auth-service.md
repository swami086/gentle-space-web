# RBAC + Google SSO Auth Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: This plan is organized into **waves** for parallel
> execution (up to 8 subagents at once, capped by real file/import dependencies — see "Parallel
> Execution Plan" for why the actual max here is 5), a deliberate deviation from
> `superpowers:subagent-driven-development`'s default "never dispatch implementers in parallel" rule
> — safe because every task within a wave owns a disjoint set of files. Use
> `superpowers:dispatching-parallel-agents` to dispatch all tasks in a wave together (multiple Task
> tool calls in the same message = parallel). **Every implementer subagent MUST use model
> `composer-2.5-fast`**. Each implementer follows `superpowers:test-driven-development` for every task
> with a Vitest cycle. Run the task-reviewer gate (spec compliance + code quality) on every task as it
> completes; do **not** dispatch the next wave until every task in the current wave has passed review
> — later waves import files earlier waves create. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `auth-service` (own Next.js app, own Postgres) that authenticates admin users via
Google SSO and owns identity/role data, and wire `ads-agent` up as a resource server that verifies
sessions locally and enforces the 3-tier RBAC model, per
[`docs/superpowers/specs/2026-08-04-rbac-auth-service-design.md`](../specs/2026-08-04-rbac-auth-service-design.md).

**Architecture:** `auth-service` runs Auth.js with a Google provider purely to complete the OAuth
handshake (no database adapter — it owns zero persistence of its own); a `bridge` route then does JIT
user/org-membership provisioning in `auth-service`'s own Postgres, mints a short-lived RS256 JWT via
`jose`, and sets it as a cookie on `.gentlespacesolutions.com` alongside a host-only rotating refresh
cookie. `ads-agent` verifies that JWT locally via `jose`'s remote-JWKS support (no per-request network
call once cached), enforces `admin > operator > viewer` in a small DAL, and JIT-provisions a local
shadow `orgs`/`users` row so the existing credit-ledger foreign keys keep working. Role assignment is
the one place the two services talk directly, via a small internal API guarded by a shared secret.

**Tech Stack:** Two independent Next.js 15 / React 19 apps (`auth-service` new, `ads-agent` existing),
Postgres (`pg`) per service, Auth.js v5 (`next-auth`) for the Google OAuth handshake, `jose` for RS256
signing/verification and remote JWKS, Vitest, Caddy for reverse proxy.

## Global Constraints

- **Model:** every implementer / reviewer subagent uses **`composer-2.5-fast`**.
- **Install deps with the package manager, never hand-pick versions.** `next-auth` and `jose` are
  installed via `npm install next-auth jose` (in `auth-service`) and `npm install jose` (in
  `ads-agent`) — whatever versions npm resolves are correct; do not hardcode a guessed semver in
  `package.json`.
- **`auth-service`'s `package.json`/`tsconfig.json`/`eslint.config.mjs`/`postcss.config.mjs`/
  `vitest.config.ts` mirror `ads-agent`'s exactly** (same `next`/`react`/`react-dom`/`typescript`/
  `vitest`/`eslint` versions, same `@/*` → `./*` path alias, same `passWithNoTests: true` +
  `resolve.alias` Vitest config to avoid the dual-module-instance `vi.mock` problem documented in
  `ads-agent/vitest.config.ts`) — see Task 1.
- **Auth.js has no database adapter.** `session: { strategy: "jwt" }`, no `adapter` configured.
  Auth.js's own session is only ever read once (by the `bridge` route, immediately after login) to
  get the Google profile; `auth-service` owns 100% of `users`/`org_members` persistence itself in its
  own schema. Do not add `@auth/pg-adapter` or any adapter package — that would create a second,
  conflicting user model.
- **JWT claims contract (do not deviate — every task that mints or verifies depends on this exact
  shape):** `{ sub: <userId>, email, orgId: string | null, role: "admin"|"operator"|"viewer"|null,
  iss: "gentlespace-auth-service", iat, exp }`. `orgId`/`role` are `null` for a pending user (logged
  in, no `org_members` row yet). The literal issuer string `"gentlespace-auth-service"` must be
  copy-pasted exactly into both `auth-service/lib/jwt.ts` (Task 2, mints/signs it) and
  `ads-agent/lib/auth/dal.ts` (Task 3, verifies it) — there is no shared package, so this is
  intentional duplication of one literal string, not an oversight.
- **Cookie contract:** `gs_session` (the JWT itself; `Domain=<COOKIE_DOMAIN>` e.g.
  `.gentlespacesolutions.com`; httpOnly; Secure; `SameSite=Lax`; ~20 min `maxAge`) and `gs_refresh`
  (opaque random token; **no `domain` set**, so it defaults host-only to `auth.gentlespacesolutions.com`
  and is never sent to `ads-agent`; httpOnly; Secure; `SameSite=Lax`; ~30 day `maxAge`).
  `COOKIE_DOMAIN` is `localhost` (no leading dot) for local dev — cookies still work across
  `localhost:3030`/`:3040` in that case since browsers treat `localhost` as a single host; there is no
  cross-subdomain cookie sharing in local dev, so local manual testing uses `curl -b/-c` or a single
  browser profile that stays on one port at a time (documented in Task 13's manual smoke).
- **Redirect safety:** any redirect to a caller-supplied `return_to` is validated in
  `auth-service/lib/safe-redirect.ts` (Task 1) against `COOKIE_DOMAIN` (host must equal or be a
  subdomain of it) or `localhost`/`127.0.0.1` for dev — never redirect anywhere else. Every route that
  redirects to a caller-supplied URL imports this one function; do not re-implement the check inline.
- **401 vs 403, never conflated:** a missing/invalid/expired session is `401` (API routes) or a
  redirect to login (pages). A valid session with an insufficient role is `403` (API routes) or an
  inline "you don't have access" notice (pages) — **never** a thrown error caught by a generic error
  boundary; Next.js sanitizes server error messages in production, so message-matching on a thrown
  error would silently break in a production build. `requireRole`/`requireApiRole` (Task 3) return a
  discriminated result object precisely to avoid this trap.
- **`middleware.ts` is a UX convenience only** (redirect-if-no-cookie-at-all), never the actual
  security boundary — every protected Server Component, Server Action, and Route Handler calls
  `requireSession`/`requireRole`/`requireApiRole` itself. This mirrors the documented Next.js
  `CVE-2025-29927` lesson in the design spec.
- **Reuse the fixed internal org UUID `00000000-0000-0000-0000-000000000001` everywhere** — it's
  already seeded in `ads-agent`'s schema (credit-ledger work) and is seeded identically in
  `auth-service`'s new schema (Task 1), so `org_balances`/`credit_grants` rows stay attached to the
  same org once real logins replace the dev seed.
- **The credit-ledger's dev-seeded user (`00000000-0000-0000-0000-000000000002`) becomes orphaned
  once real logins exist** — a real Google login mints a fresh `users.id` in `auth-service`, which
  JIT-provisions a *different* shadow row in `ads-agent`. This is expected; no migration of the old
  dev-seed usage rows is in scope (the credit-accounting spec's own Non-goals already called out that
  the dev seed was a placeholder for exactly this reason).
- **`ads-agent`'s existing `users.role` column (`'admin'|'member'`, from the credit-ledger schema)
  becomes vestigial** — the real role now lives only in the JWT/session, sourced from
  `auth-service`. Leave the column and its `CHECK` constraint in place (no migration); JIT-provisioning
  (Task 3) always writes the literal `'member'` into it and nothing ever reads it again.
- **Money-shaped / DB-numeric columns are read back as strings by `pg`** — every new query module in
  this plan follows the same `Number(...)` conversion convention as every existing `lib/db/*.ts` in
  `ads-agent`.
- **`auth-service` follows every `ads-agent` testing convention from scratch:** colocated `*.test.ts`,
  `vi.mock("../db/client", () => ({ getPool: () => ({ query, connect }) }))`, camelCase TS fields
  mapped from `snake_case` SQL columns.
- **No new infra dependency for rate-limiting.** Nothing in the repo uses Redis; the login/callback
  rate limiter (Task 6) is a single-process in-memory sliding window keyed by IP, with a `ponytail:`
  comment noting the ceiling (doesn't survive a restart or multiple instances) and the upgrade path
  (swap in `@upstash/ratelimit` if `auth-service` is ever horizontally scaled).

---

## Parallel Execution Plan

```text
Wave 0 (5 parallel)  Task 1 — auth-service scaffold + full data layer + safe-redirect util   [Composer 2.5]
                     Task 2 — auth-service lib/jwt.ts (mint/verify/JWKS)                     [Composer 2.5]
                     Task 3 — ads-agent lib/auth/dal.ts + middleware.ts                      [Composer 2.5]
                     Task 4 — deploy/Caddyfile + docker-compose.prod.yml                     [Composer 2.5]
                     Task 5 — ads-agent lib/auth/internal-client.ts                          [Composer 2.5]
                        ↓ (all 5 must pass review first)
Wave 1 (5 parallel)  Task 6 — auth-service Auth.js + login page + bridge route + bootstrap   [Composer 2.5]
                     Task 7 — auth-service JWKS + refresh routes                             [Composer 2.5]
                     Task 8 — auth-service internal org-members API                          [Composer 2.5]
                     Task 9 — ads-agent admin-only wiring (layout, credits, settings)         [Composer 2.5]
                     Task 10 — ads-agent operator+ wiring (campaigns, proposals, chat ctx)    [Composer 2.5]
                        ↓ (all 5 must pass review first)
Wave 2 (2 parallel)  Task 11 — ads-agent /(admin)/users page + sidebar entry                 [Composer 2.5]
                     Task 12 — Google OAuth Client + keypair setup runbook (docs only)        [Composer 2.5]
                        ↓ (both must pass review first)
Wave 3 (solo)        Task 13 — Full suite green + manual E2E smoke                           [Composer 2.5]
```

Max concurrency = **5**, under the 8-subagent ceiling — do not invent extra parallel work. Wave 0's
five tasks share zero imports (Tasks 3 and 5 verify/call a *contract*, not any of auth-service's actual
files, since the two apps never import across the process boundary). Wave 1's five tasks each import
only from Wave 0's outputs and never from each other (Task 6/7/8 are three different route files in
`auth-service` that each depend on Task 1's data layer + Task 2's `jwt.ts`; Task 9/10 are disjoint sets
of `ads-agent` pages that each depend only on Task 3's DAL). Splitting Task 1 further would fragment one
cohesive data-access layer across subagents that all touch the same `schema.sql`; splitting Task 9/10
further than "admin-only surfaces" vs "operator+ surfaces" would fragment two cohesive route-guard
passes for no real gain.

**Dispatch template (parent):** for each wave, issue one `Task` call per task in the same message with
`model: "composer-2.5-fast"`, `subagent_type: "generalPurpose"`, and a self-contained prompt that pastes
this task's Files / Interfaces / Steps (agents do not inherit parent context).

Each task's **Interfaces** block states exactly what it consumes from an earlier wave and produces for
a later one; siblings within a wave touch disjoint files and never call each other.

---

### Task 1: `auth-service` scaffold + full data layer + safe-redirect util

**Files:**
- Create: `auth-service/package.json`, `auth-service/tsconfig.json`, `auth-service/next.config.ts`,
  `auth-service/eslint.config.mjs`, `auth-service/postcss.config.mjs`, `auth-service/vitest.config.ts`,
  `auth-service/next-env.d.ts`, `auth-service/.gitignore`, `auth-service/.env.example`,
  `auth-service/docker-compose.yml`
- Create: `auth-service/app/layout.tsx`, `auth-service/app/page.tsx`, `auth-service/app/globals.css`
- Create: `auth-service/lib/types.ts`
- Create: `auth-service/lib/db/client.ts`, `auth-service/lib/db/schema.sql`,
  `auth-service/lib/db/migrate.ts`
- Create: `auth-service/lib/db/users.ts`, `auth-service/lib/db/users.test.ts`
- Create: `auth-service/lib/db/org-members.ts`, `auth-service/lib/db/org-members.test.ts`
- Create: `auth-service/lib/db/refresh-tokens.ts`, `auth-service/lib/db/refresh-tokens.test.ts`
- Create: `auth-service/lib/safe-redirect.ts`, `auth-service/lib/safe-redirect.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (consumed by Tasks 2, 6, 7, 8, 12): `getPool()` from `lib/db/client.ts`; `MemberRole` type
  from `lib/types.ts`; `findOrCreateUserByGoogle(input)`, `findUserById(id)`, `touchLastLogin(id)` from
  `lib/db/users.ts`; `getMembership(userId)`, `upsertMembership(input)`, `listMembers(orgId)`,
  `listPendingUsers()`, `INTERNAL_ORG_ID` from `lib/db/org-members.ts`;
  `createRefreshToken(userId)`, `rotateRefreshToken(rawToken)`, `revokeRefreshToken(rawToken)` from
  `lib/db/refresh-tokens.ts`; `safeReturnTo(value, baseUrl)` from `lib/safe-redirect.ts`.

- [ ] **Step 1: Scaffold the app skeleton**

```bash
mkdir -p auth-service
cd auth-service
```

`auth-service/package.json`:

```json
{
  "name": "auth-service",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3040",
    "build": "next build",
    "start": "next start -p 3040",
    "lint": "eslint",
    "test": "vitest run",
    "migrate": "tsx --env-file=.env.local lib/db/migrate.ts"
  },
  "dependencies": {
    "next": "15.5.21",
    "pg": "^8.22.0",
    "react": "19.2.4",
    "react-dom": "19.2.4"
  },
  "devDependencies": {
    "@eslint/eslintrc": "^3",
    "@tailwindcss/postcss": "^4.3.3",
    "@types/node": "^20",
    "@types/pg": "^8.20.0",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "15.5.21",
    "tailwindcss": "^4.3.3",
    "tsx": "^4.21.0",
    "typescript": "^5",
    "vitest": "^4.1.10"
  }
}
```

`auth-service/tsconfig.json` (identical to `ads-agent/tsconfig.json`):

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

`auth-service/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // JWKS must be reachable at the RFC 5785 well-known path; the real route lives at
    // /api/jwks (Task 7) since Next.js route folders starting with "." are unreliable.
    return [{ source: "/.well-known/jwks.json", destination: "/api/jwks" }];
  },
};

export default nextConfig;
```

`auth-service/eslint.config.mjs` (identical to `ads-agent`'s):

```js
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [...compat.extends("next/core-web-vitals", "next/typescript")];
```

`auth-service/postcss.config.mjs` (identical to `ads-agent`'s):

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

`auth-service/vitest.config.ts` (identical alias fix as `ads-agent`'s):

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
```

`auth-service/.gitignore`:

```
node_modules
.next
.env.local
*.tsbuildinfo
```

`auth-service/docker-compose.yml` (own local Postgres, different port from `ads-agent`'s `5434`):

```yaml
name: auth-service

services:
  db:
    image: postgres:16
    ports:
      - "5435:5432"
    environment:
      POSTGRES_DB: auth_service
      POSTGRES_USER: auth_service
      POSTGRES_PASSWORD: auth_service_local_dev
    volumes:
      - auth-service-db-data:/var/lib/postgresql/data
    healthcheck:
      test: pg_isready -U auth_service -h localhost -d auth_service
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

volumes:
  auth-service-db-data:
```

`auth-service/.env.example`:

```
# Own local Postgres (docker compose up -d in this folder)
DATABASE_URL=postgres://auth_service:auth_service_local_dev@localhost:5435/auth_service

# Google OAuth 2.0 Client (Web application) — see docs/RUNBOOK.md (Task 12) for setup steps
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Auth.js's own cookie-encryption secret (its internal session, read once by the bridge route).
# Generate with: openssl rand -base64 32
AUTH_SECRET=
AUTH_TRUST_HOST=true

# RS256 keypair for the gs_session JWT — see docs/RUNBOOK.md (Task 12) for generation steps.
# PEM strings with literal \n escapes (not real newlines) in .env files.
AUTH_JWT_PRIVATE_KEY_PEM=
AUTH_JWT_PUBLIC_KEY_PEM=
AUTH_JWT_KID=auth-service-key-1

# Comma-separated emails that get auto-granted the admin role on their very first login.
# Every role change after that happens through the /(admin)/users UI in ads-agent, not this var.
ADMIN_BOOTSTRAP_EMAILS=

# Shared secret ads-agent sends as the x-internal-api-key header on /internal/org-members calls.
INTERNAL_API_KEY=

# Cookie domain for gs_session (shared with ads-agent). Use "localhost" (no leading dot) for local dev.
COOKIE_DOMAIN=localhost
```

Minimal placeholder pages so the app builds:

`auth-service/app/globals.css`:

```css
@import "tailwindcss";
```

`auth-service/app/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Gentle Space Auth" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`auth-service/app/page.tsx`:

```tsx
export default function HomePage() {
  return <p className="p-6 text-sm text-gray-500">auth-service is running.</p>;
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd auth-service
npm install
```

- [ ] **Step 3: `auth-service/lib/types.ts`**

```ts
export type MemberRole = "admin" | "operator" | "viewer";
```

- [ ] **Step 4: `auth-service/lib/db/client.ts`** (identical pattern to `ads-agent/lib/db/client.ts`)

```ts
import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}
```

- [ ] **Step 5: `auth-service/lib/db/schema.sql`** (exactly matches the design spec's data model)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'external' CHECK (kind IN ('internal','external')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  google_sub TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

DO $$ BEGIN
  CREATE TYPE member_role AS ENUM ('admin', 'operator', 'viewer');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS org_members (
  org_id UUID NOT NULL REFERENCES orgs(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role member_role NOT NULL,
  invited_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id),
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- Reuse the same fixed org UUID ads-agent's credit-ledger schema already seeded, so
-- org_balances/credit_grants stay attached to the same org once real logins exist.
INSERT INTO orgs (id, name, kind) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Gentle Space (internal)', 'internal')
ON CONFLICT (id) DO NOTHING;
```

`CREATE TYPE ... EXCEPTION WHEN duplicate_object` is the standard idempotent-enum pattern (unlike
tables, `CREATE TYPE` has no `IF NOT EXISTS`), needed since `migrate.ts` runs `schema.sql` on every
deploy.

- [ ] **Step 6: `auth-service/lib/db/migrate.ts`** (identical pattern to `ads-agent/lib/db/migrate.ts`)

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { getPool } from "./client";

export async function migrate(): Promise<void> {
  const schemaPath = path.join(process.cwd(), "lib/db/schema.sql");
  const sql = readFileSync(schemaPath, "utf-8");
  await getPool().query(sql);
}

async function main(): Promise<void> {
  await migrate();
  console.log("auth-service: schema applied");
}

main().catch((err) => {
  console.error("auth-service: migration failed", err);
  process.exit(1);
});
```

- [ ] **Step 7: Write failing tests — `auth-service/lib/db/users.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import { findOrCreateUserByGoogle, findUserById, touchLastLogin } from "./users";

beforeEach(() => query.mockReset());

describe("findOrCreateUserByGoogle", () => {
  it("returns the existing user when google_sub already exists", async () => {
    query.mockResolvedValue({
      rows: [{ id: "u-1", email: "a@x.com", name: "A", avatar_url: null }],
    });
    const user = await findOrCreateUserByGoogle({
      googleSub: "g-1",
      email: "a@x.com",
      name: "A",
      avatarUrl: null,
    });
    expect(user).toEqual({ id: "u-1", email: "a@x.com", name: "A", avatarUrl: null });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO users"), [
      "g-1",
      "a@x.com",
      "A",
      null,
    ]);
  });
});

describe("findUserById", () => {
  it("returns null when no user exists", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(findUserById("missing")).resolves.toBeNull();
  });

  it("returns the mapped user when found", async () => {
    query.mockResolvedValue({
      rows: [{ id: "u-1", email: "a@x.com", name: null, avatar_url: null }],
    });
    await expect(findUserById("u-1")).resolves.toEqual({
      id: "u-1",
      email: "a@x.com",
      name: null,
      avatarUrl: null,
    });
  });
});

describe("touchLastLogin", () => {
  it("updates last_login_at for the given user", async () => {
    query.mockResolvedValue({ rows: [] });
    await touchLastLogin("u-1");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE users"), ["u-1"]);
  });
});
```

- [ ] **Step 8: Run tests — expect FAIL**

```bash
cd auth-service && npx vitest run lib/db/users.test.ts
```

- [ ] **Step 9: Implement `auth-service/lib/db/users.ts`**

```ts
import { getPool } from "./client";

export type User = { id: string; email: string; name: string | null; avatarUrl: string | null };

type UserRow = { id: string; email: string; name: string | null; avatar_url: string | null };

function mapUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, avatarUrl: row.avatar_url };
}

export async function findOrCreateUserByGoogle(input: {
  googleSub: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}): Promise<User> {
  const { rows } = await getPool().query<UserRow>(
    `INSERT INTO users (google_sub, email, name, avatar_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (google_sub)
     DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
     RETURNING id, email, name, avatar_url`,
    [input.googleSub, input.email, input.name, input.avatarUrl],
  );
  return mapUser(rows[0]);
}

export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await getPool().query<UserRow>(
    `SELECT id, email, name, avatar_url FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function touchLastLogin(id: string): Promise<void> {
  await getPool().query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [id]);
}
```

- [ ] **Step 10: Run tests — expect PASS**

```bash
cd auth-service && npx vitest run lib/db/users.test.ts
```

- [ ] **Step 11: Write failing tests — `auth-service/lib/db/org-members.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import {
  getMembership,
  upsertMembership,
  listMembers,
  listPendingUsers,
  INTERNAL_ORG_ID,
} from "./org-members";

beforeEach(() => query.mockReset());

describe("getMembership", () => {
  it("returns null when the user has no membership yet (pending)", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getMembership("u-1")).resolves.toBeNull();
  });

  it("returns orgId + role when a membership exists", async () => {
    query.mockResolvedValue({ rows: [{ org_id: INTERNAL_ORG_ID, role: "admin" }] });
    await expect(getMembership("u-1")).resolves.toEqual({ orgId: INTERNAL_ORG_ID, role: "admin" });
  });
});

describe("upsertMembership", () => {
  it("inserts a new membership row", async () => {
    query.mockResolvedValue({ rows: [] });
    await upsertMembership({ orgId: INTERNAL_ORG_ID, userId: "u-1", role: "operator", invitedBy: null });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO org_members"), [
      INTERNAL_ORG_ID,
      "u-1",
      "operator",
      null,
    ]);
  });
});

describe("listMembers / listPendingUsers", () => {
  it("maps member rows with role and last login", async () => {
    query.mockResolvedValue({
      rows: [
        {
          user_id: "u-1",
          email: "a@x.com",
          name: "A",
          role: "admin",
          last_login_at: new Date("2026-08-04T00:00:00.000Z"),
        },
      ],
    });
    await expect(listMembers(INTERNAL_ORG_ID)).resolves.toEqual([
      {
        userId: "u-1",
        email: "a@x.com",
        name: "A",
        role: "admin",
        lastLoginAt: "2026-08-04T00:00:00.000Z",
      },
    ]);
  });

  it("returns pending users (no org_members row)", async () => {
    query.mockResolvedValue({ rows: [{ user_id: "u-2", email: "b@x.com", name: null }] });
    await expect(listPendingUsers()).resolves.toEqual([
      { userId: "u-2", email: "b@x.com", name: null },
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("LEFT JOIN org_members"));
  });
});
```

- [ ] **Step 12: Run tests — expect FAIL**

```bash
cd auth-service && npx vitest run lib/db/org-members.test.ts
```

- [ ] **Step 13: Implement `auth-service/lib/db/org-members.ts`**

```ts
import { getPool } from "./client";
import type { MemberRole } from "../types";

export const INTERNAL_ORG_ID = "00000000-0000-0000-0000-000000000001";

export type Membership = { orgId: string; role: MemberRole };

export async function getMembership(userId: string): Promise<Membership | null> {
  const { rows } = await getPool().query<{ org_id: string; role: MemberRole }>(
    `SELECT org_id, role FROM org_members WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ? { orgId: rows[0].org_id, role: rows[0].role } : null;
}

export async function upsertMembership(input: {
  orgId: string;
  userId: string;
  role: MemberRole;
  invitedBy: string | null;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO org_members (org_id, user_id, role, invited_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`,
    [input.orgId, input.userId, input.role, input.invitedBy],
  );
}

export type MemberRow = {
  userId: string;
  email: string;
  name: string | null;
  role: MemberRole;
  lastLoginAt: string | null;
};

export async function listMembers(orgId: string): Promise<MemberRow[]> {
  const { rows } = await getPool().query<{
    user_id: string;
    email: string;
    name: string | null;
    role: MemberRole;
    last_login_at: Date | null;
  }>(
    `SELECT u.id AS user_id, u.email, u.name, m.role, u.last_login_at
     FROM org_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1
     ORDER BY u.created_at ASC`,
    [orgId],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
  }));
}

export type PendingUserRow = { userId: string; email: string; name: string | null };

export async function listPendingUsers(): Promise<PendingUserRow[]> {
  const { rows } = await getPool().query<{ user_id: string; email: string; name: string | null }>(
    `SELECT u.id AS user_id, u.email, u.name
     FROM users u
     LEFT JOIN org_members m ON m.user_id = u.id
     WHERE m.user_id IS NULL
     ORDER BY u.created_at ASC`,
  );
  return rows.map((row) => ({ userId: row.user_id, email: row.email, name: row.name }));
}
```

- [ ] **Step 14: Run tests — expect PASS**

```bash
cd auth-service && npx vitest run lib/db/org-members.test.ts
```

- [ ] **Step 15: Write failing tests — `auth-service/lib/db/refresh-tokens.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import { createRefreshToken, rotateRefreshToken, revokeRefreshToken } from "./refresh-tokens";

beforeEach(() => query.mockReset());

describe("createRefreshToken", () => {
  it("inserts a hashed token and returns the raw token", async () => {
    query.mockResolvedValue({ rows: [] });
    const raw = await createRefreshToken("u-1");
    expect(typeof raw).toBe("string");
    expect(raw.length).toBeGreaterThan(20);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO refresh_tokens"),
      expect.arrayContaining(["u-1"]),
    );
  });
});

describe("rotateRefreshToken", () => {
  it("returns null when the token doesn't match any row", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(rotateRefreshToken("bogus")).resolves.toBeNull();
  });

  it("returns null when the matching row is expired", async () => {
    query.mockResolvedValue({
      rows: [{ id: "rt-1", user_id: "u-1", expires_at: new Date(Date.now() - 1000), revoked_at: null }],
    });
    await expect(rotateRefreshToken("raw-token")).resolves.toBeNull();
  });

  it("returns null when the matching row was already revoked", async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: "rt-1",
          user_id: "u-1",
          expires_at: new Date(Date.now() + 100000),
          revoked_at: new Date(),
        },
      ],
    });
    await expect(rotateRefreshToken("raw-token")).resolves.toBeNull();
  });

  it("revokes the old token and issues a new one when valid", async () => {
    query.mockImplementation((sql: string) => {
      if (sql.startsWith("SELECT")) {
        return Promise.resolve({
          rows: [
            {
              id: "rt-1",
              user_id: "u-1",
              expires_at: new Date(Date.now() + 100000),
              revoked_at: null,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const result = await rotateRefreshToken("raw-token");
    expect(result?.userId).toBe("u-1");
    expect(typeof result?.newRawToken).toBe("string");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE refresh_tokens"), ["rt-1"]);
  });
});

describe("revokeRefreshToken", () => {
  it("marks the matching token revoked", async () => {
    query.mockResolvedValue({ rows: [] });
    await revokeRefreshToken("raw-token");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE refresh_tokens"), [
      expect.any(String),
    ]);
  });
});
```

- [ ] **Step 16: Run tests — expect FAIL**

```bash
cd auth-service && npx vitest run lib/db/refresh-tokens.test.ts
```

- [ ] **Step 17: Implement `auth-service/lib/db/refresh-tokens.ts`**

```ts
import { randomBytes, createHash } from "node:crypto";
import { getPool } from "./client";

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hash(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function createRefreshToken(userId: string): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await getPool().query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [userId, hash(raw)],
  );
  return raw;
}

export async function rotateRefreshToken(
  rawToken: string,
): Promise<{ userId: string; newRawToken: string } | null> {
  const { rows } = await getPool().query<{
    id: string;
    user_id: string;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1`,
    [hash(rawToken)],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at.getTime() < Date.now()) return null;

  await getPool().query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, [row.id]);
  const newRawToken = await createRefreshToken(row.user_id);
  return { userId: row.user_id, newRawToken };
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await getPool().query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`, [
    hash(rawToken),
  ]);
}
```

`TTL_MS` is currently unused in code (the interval is hardcoded in SQL for simplicity) — remove the
constant if lint flags it as unused, or reference it via a template literal; either is fine.

- [ ] **Step 18: Run tests — expect PASS**

```bash
cd auth-service && npx vitest run lib/db/refresh-tokens.test.ts
```

- [ ] **Step 19: Write failing tests — `auth-service/lib/safe-redirect.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./safe-redirect";

describe("safeReturnTo", () => {
  it("falls back to / when value is missing", () => {
    expect(safeReturnTo(null, "https://auth.gentlespacesolutions.com", "gentlespacesolutions.com")).toBe(
      "https://auth.gentlespacesolutions.com/",
    );
  });

  it("falls back to / when value is not a valid URL", () => {
    expect(
      safeReturnTo("not a url", "https://auth.gentlespacesolutions.com", "gentlespacesolutions.com"),
    ).toBe("https://auth.gentlespacesolutions.com/");
  });

  it("allows a URL on the exact cookie-domain host", () => {
    const value = "https://gentlespacesolutions.com/foo";
    expect(safeReturnTo(value, "https://auth.gentlespacesolutions.com", "gentlespacesolutions.com")).toBe(
      value,
    );
  });

  it("allows a URL on a subdomain of the cookie domain", () => {
    const value = "https://ads.gentlespacesolutions.com/campaigns";
    expect(safeReturnTo(value, "https://auth.gentlespacesolutions.com", "gentlespacesolutions.com")).toBe(
      value,
    );
  });

  it("rejects an unrelated external host", () => {
    expect(
      safeReturnTo(
        "https://evil.example.com/phish",
        "https://auth.gentlespacesolutions.com",
        "gentlespacesolutions.com",
      ),
    ).toBe("https://auth.gentlespacesolutions.com/");
  });

  it("allows localhost for local dev regardless of cookieDomain", () => {
    const value = "http://localhost:3030/campaigns";
    expect(safeReturnTo(value, "http://localhost:3040", "localhost")).toBe(value);
  });
});
```

- [ ] **Step 20: Run tests — expect FAIL**

```bash
cd auth-service && npx vitest run lib/safe-redirect.test.ts
```

- [ ] **Step 21: Implement `auth-service/lib/safe-redirect.ts`**

```ts
/**
 * Validates a caller-supplied return_to URL against an allowlist before ever redirecting to it.
 * cookieDomain is the bare host (no leading dot), e.g. "gentlespacesolutions.com" — a target is
 * allowed if its hostname equals that host or is a subdomain of it, or if it's localhost/127.0.0.1
 * (for local dev, where auth-service and ads-agent run on different localhost ports).
 */
export function safeReturnTo(value: string | null, baseUrl: string, cookieDomain: string): string {
  const fallback = new URL("/", baseUrl).toString();
  if (!value) return fallback;

  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return fallback;
  }

  const isLocalDev = target.hostname === "localhost" || target.hostname === "127.0.0.1";
  const bareDomain = cookieDomain.replace(/^\./, "");
  const isKnownHost =
    bareDomain !== "" &&
    bareDomain !== "localhost" &&
    (target.hostname === bareDomain || target.hostname.endsWith(`.${bareDomain}`));

  return isLocalDev || isKnownHost ? value : fallback;
}
```

- [ ] **Step 22: Run tests — expect PASS**

```bash
cd auth-service && npx vitest run lib/safe-redirect.test.ts
```

- [ ] **Step 23: Apply schema against a local Postgres and verify idempotency**

```bash
cd auth-service
docker compose up -d db
cp .env.example .env.local   # fill in DATABASE_URL only for this step; other vars aren't needed yet
npx tsx --env-file=.env.local lib/db/migrate.ts
npx tsx --env-file=.env.local lib/db/migrate.ts   # run twice — must not error or duplicate the seed
```

Expected: `auth-service: schema applied` both times, no errors.

- [ ] **Step 24: Full test run + typecheck**

```bash
cd auth-service
npx vitest run
npx tsc --noEmit
```

- [ ] **Step 25: Commit**

```bash
git add auth-service/package.json auth-service/tsconfig.json auth-service/next.config.ts \
  auth-service/eslint.config.mjs auth-service/postcss.config.mjs auth-service/vitest.config.ts \
  auth-service/.gitignore auth-service/.env.example auth-service/docker-compose.yml \
  auth-service/app auth-service/lib
git commit -m "$(cat <<'EOF'
feat(auth-service): scaffold new app with identity/RBAC data layer

EOF
)"
```

---

### Task 2: `auth-service/lib/jwt.ts` (mint / verify / JWKS) + tests

**Files:**
- Create: `auth-service/lib/jwt.ts`
- Create: `auth-service/lib/jwt.test.ts`

**Interfaces:**
- Consumes: `MemberRole` from `./types` (Task 1 — a plain type import, no runtime coupling, safe in
  the same wave). Requires the `jose` package — installed in Step 1 below.
- Produces (consumed by Tasks 6, 7, 8's siblings in Wave 1): `mintAccessToken(claims):
  Promise<string>`, `getJwks(): Promise<{keys: object[]}>`, `AccessTokenClaims` type. Also exports
  `verifyAccessToken(token)` used only by this task's own round-trip tests.

- [ ] **Step 1: Install `jose` and generate a local test RS256 keypair**

```bash
cd auth-service
npm install jose
node -e "
const { generateKeyPairSync } = require('crypto');
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pub = publicKey.export({ type: 'spki', format: 'pem' });
console.log('AUTH_JWT_PRIVATE_KEY_PEM=' + priv.replace(/\n/g, '\\\\n'));
console.log('AUTH_JWT_PUBLIC_KEY_PEM=' + pub.replace(/\n/g, '\\\\n'));
" >> .env.local
echo "AUTH_JWT_KID=auth-service-key-1" >> .env.local
```

This generates a real keypair for local dev/testing only — production keys are generated the same
way but stored as deployment secrets (Task 12's runbook covers this).

- [ ] **Step 2: Write the failing tests — `auth-service/lib/jwt.test.ts`**

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { mintAccessToken, verifyAccessToken, getJwks } from "./jwt";

beforeAll(() => {
  if (!process.env.AUTH_JWT_PRIVATE_KEY_PEM || !process.env.AUTH_JWT_PUBLIC_KEY_PEM) {
    throw new Error(
      "AUTH_JWT_PRIVATE_KEY_PEM/AUTH_JWT_PUBLIC_KEY_PEM must be set in .env.local for these tests " +
        "(see Task 2 Step 1) — vitest picks up .env.local automatically via dotenv if configured, " +
        "or run with `npx vitest run --env-file=.env.local`.",
    );
  }
});

describe("mintAccessToken / verifyAccessToken round-trip", () => {
  it("mints a token whose claims verify back correctly for an active user", async () => {
    const token = await mintAccessToken({
      sub: "user-1",
      email: "a@x.com",
      orgId: "org-1",
      role: "admin",
    });
    const claims = await verifyAccessToken(token);
    expect(claims).toEqual({ sub: "user-1", email: "a@x.com", orgId: "org-1", role: "admin" });
  });

  it("mints a pending-user token with null orgId/role", async () => {
    const token = await mintAccessToken({ sub: "user-2", email: "b@x.com", orgId: null, role: null });
    const claims = await verifyAccessToken(token);
    expect(claims.orgId).toBeNull();
    expect(claims.role).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const token = await mintAccessToken({ sub: "user-1", email: "a@x.com", orgId: null, role: null });
    const tampered = token.slice(0, -2) + "xx";
    await expect(verifyAccessToken(tampered)).rejects.toThrow();
  });
});

describe("getJwks", () => {
  it("exposes exactly one RSA public key tagged with the configured kid", async () => {
    const jwks = await getJwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kid: process.env.AUTH_JWT_KID, use: "sig", alg: "RS256" });
    expect(jwks.keys[0]).not.toHaveProperty("d"); // never leak the private exponent
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd auth-service && npx vitest run --env-file=.env.local lib/jwt.test.ts
```

- [ ] **Step 4: Implement `auth-service/lib/jwt.ts`**

```ts
import { SignJWT, jwtVerify, importPKCS8, importSPKI, exportJWK, type KeyLike } from "jose";
import type { MemberRole } from "./types";

// This literal MUST match the AUTH_ISSUER constant in ads-agent/lib/auth/dal.ts exactly — there is
// no shared package between the two services, so this is intentional duplication (see plan's
// Global Constraints).
const AUTH_ISSUER = "gentlespace-auth-service";
const ACCESS_TOKEN_TTL = "20m";

function pem(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value.replace(/\\n/g, "\n");
}

function kid(): string {
  const value = process.env.AUTH_JWT_KID;
  if (!value) throw new Error("AUTH_JWT_KID is not set");
  return value;
}

let privateKeyPromise: Promise<KeyLike> | null = null;
function getPrivateKey(): Promise<KeyLike> {
  if (!privateKeyPromise) privateKeyPromise = importPKCS8(pem("AUTH_JWT_PRIVATE_KEY_PEM"), "RS256");
  return privateKeyPromise;
}

let publicKeyPromise: Promise<KeyLike> | null = null;
function getPublicKey(): Promise<KeyLike> {
  if (!publicKeyPromise) publicKeyPromise = importSPKI(pem("AUTH_JWT_PUBLIC_KEY_PEM"), "RS256");
  return publicKeyPromise;
}

export type AccessTokenClaims = {
  sub: string;
  email: string;
  orgId: string | null;
  role: MemberRole | null;
};

export async function mintAccessToken(claims: AccessTokenClaims): Promise<string> {
  const key = await getPrivateKey();
  return new SignJWT({ email: claims.email, orgId: claims.orgId, role: claims.role })
    .setProtectedHeader({ alg: "RS256", kid: kid() })
    .setSubject(claims.sub)
    .setIssuer(AUTH_ISSUER)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const key = await getPublicKey();
  const { payload } = await jwtVerify(token, key, { issuer: AUTH_ISSUER });
  return {
    sub: String(payload.sub),
    email: String(payload.email ?? ""),
    orgId: typeof payload.orgId === "string" ? payload.orgId : null,
    role: typeof payload.role === "string" ? (payload.role as MemberRole) : null,
  };
}

export async function getJwks(): Promise<{ keys: Record<string, unknown>[] }> {
  const key = await getPublicKey();
  const jwk = await exportJWK(key);
  return { keys: [{ ...jwk, kid: kid(), use: "sig", alg: "RS256" }] };
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd auth-service && npx vitest run --env-file=.env.local lib/jwt.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add auth-service/package.json auth-service/package-lock.json auth-service/lib/jwt.ts \
  auth-service/lib/jwt.test.ts
git commit -m "$(cat <<'EOF'
feat(auth-service): add RS256 access-token signing/verification

EOF
)"
```

---

### Task 3: `ads-agent/lib/auth/dal.ts` + `middleware.ts` + tests

**Files:**
- Create: `ads-agent/lib/auth/dal.ts`
- Create: `ads-agent/lib/auth/dal.test.ts`
- Create: `ads-agent/middleware.ts`
- Create: `ads-agent/middleware.test.ts`
- Create: `ads-agent/components/ForbiddenNotice.tsx`

**Interfaces:**
- Consumes: `getPool` from `../db/client` (pre-existing, from the credit-ledger work). Requires the
  `jose` package — installed in Step 1. Does **not** import anything from `auth-service` (cross-app;
  only a documented JWT-claims contract, per Global Constraints).
- Produces (consumed by Tasks 9, 10, 11): `MemberRole` type, `Session` type, `getSession(): Promise<
  Session | null>`, `requireSession(): Promise<Session>` (redirects to login if none),
  `requireRole(min): Promise<RoleCheckResult>`, `requireApiRole(min): Promise<ApiRoleCheckResult>`.

- [ ] **Step 1: Install `jose`**

```bash
cd ads-agent
npm install jose
```

- [ ] **Step 2: Write the failing tests — `ads-agent/lib/auth/dal.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = { get: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const jwtVerifyMock = vi.fn();
vi.mock("jose", () => ({
  jwtVerify: (...args: unknown[]) => jwtVerifyMock(...args),
  createRemoteJWKSet: vi.fn(() => "jwks-handle"),
}));

const query = vi.fn();
vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));

process.env.AUTH_SERVICE_URL = "http://localhost:3040";

import { getSession, requireSession, requireRole, requireApiRole } from "./dal";

beforeEach(() => {
  cookieStore.get.mockReset();
  jwtVerifyMock.mockReset();
  query.mockReset();
  redirectMock.mockClear();
  query.mockResolvedValue({ rows: [] });
});

describe("getSession", () => {
  it("returns null when there is no session cookie", async () => {
    cookieStore.get.mockReturnValue(undefined);
    await expect(getSession()).resolves.toBeNull();
  });

  it("returns null when jwtVerify throws (invalid/expired/tampered)", async () => {
    cookieStore.get.mockReturnValue({ value: "bad-token" });
    jwtVerifyMock.mockRejectedValue(new Error("signature verification failed"));
    await expect(getSession()).resolves.toBeNull();
  });

  it("maps a valid pending-user token (no orgId/role) without JIT-provisioning", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: null, role: null },
    });
    await expect(getSession()).resolves.toEqual({
      userId: "u-1",
      email: "a@x.com",
      orgId: null,
      role: null,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("JIT-provisions shadow orgs/users rows for an active member", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: "org-1", role: "operator" },
    });
    const session = await getSession();
    expect(session).toEqual({ userId: "u-1", email: "a@x.com", orgId: "org-1", role: "operator" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO orgs"), ["org-1"]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO users"),
      expect.arrayContaining(["u-1", "org-1", "a@x.com"]),
    );
  });
});

describe("requireSession", () => {
  it("redirects to the auth-service login page when there is no session", async () => {
    cookieStore.get.mockReturnValue(undefined);
    await expect(requireSession()).rejects.toThrow("REDIRECT:http://localhost:3040/login");
  });

  it("returns the session when one exists", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: "org-1", role: "admin" },
    });
    await expect(requireSession()).resolves.toMatchObject({ userId: "u-1", role: "admin" });
  });
});

describe("requireRole", () => {
  it("reports unauthenticated when there is no session", async () => {
    cookieStore.get.mockReturnValue(undefined);
    await expect(requireRole("viewer")).resolves.toEqual({
      ok: false,
      session: null,
      reason: "unauthenticated",
    });
  });

  it("reports forbidden when the session has no role (pending)", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: null, role: null },
    });
    const result = await requireRole("viewer");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("forbidden");
  });

  it("reports forbidden when role rank is too low", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: "org-1", role: "viewer" },
    });
    const result = await requireRole("admin");
    expect(result.ok).toBe(false);
  });

  it("reports ok when role rank is sufficient", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: "org-1", role: "admin" },
    });
    const result = await requireRole("operator");
    expect(result.ok).toBe(true);
  });
});

describe("requireApiRole", () => {
  it("returns a 401 response when there is no session", async () => {
    cookieStore.get.mockReturnValue(undefined);
    const result = await requireApiRole("viewer");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("returns a 403 response when the role is insufficient", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: "org-1", role: "viewer" },
    });
    const result = await requireApiRole("admin");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("returns the session when the role is sufficient", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: "org-1", role: "admin" },
    });
    const result = await requireApiRole("admin");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.userId).toBe("u-1");
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd ads-agent && npx vitest run lib/auth/dal.test.ts
```

- [ ] **Step 4: Implement `ads-agent/lib/auth/dal.ts`**

```ts
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { NextResponse } from "next/server";
import { getPool } from "../db/client";

// This literal MUST match the AUTH_ISSUER constant in auth-service/lib/jwt.ts exactly — there is no
// shared package between the two services, so this is intentional duplication (see plan's Global
// Constraints).
const AUTH_ISSUER = "gentlespace-auth-service";

export type MemberRole = "admin" | "operator" | "viewer";
export type Session = { userId: string; email: string; orgId: string | null; role: MemberRole | null };

const ROLE_RANK: Record<MemberRole, number> = { viewer: 1, operator: 2, admin: 3 };

function authServiceUrl(): string {
  const url = process.env.AUTH_SERVICE_URL;
  if (!url) throw new Error("AUTH_SERVICE_URL is not set");
  return url;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL("/.well-known/jwks.json", authServiceUrl()));
  return jwks;
}

/**
 * ponytail: upserts the shadow orgs/users rows on every verified request rather than once per
 * session. Ceiling: one extra idempotent upsert per request. Upgrade path: skip it when a
 * short-lived in-memory "already provisioned this userId" set says it's redundant — not worth the
 * complexity at current admin-portal traffic levels.
 */
async function ensureShadowRows(session: Session): Promise<void> {
  if (!session.orgId) return; // pending users have no org yet, nothing to shadow
  await getPool().query(
    `INSERT INTO orgs (id, name, kind) VALUES ($1, 'Gentle Space (internal)', 'internal')
     ON CONFLICT (id) DO NOTHING`,
    [session.orgId],
  );
  await getPool().query(
    `INSERT INTO users (id, org_id, email, display_name, role)
     VALUES ($1, $2, $3, $3, 'member')
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
    [session.userId, session.orgId, session.email],
  );
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get("gs_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwks(), { issuer: AUTH_ISSUER });
    const session: Session = {
      userId: String(payload.sub),
      email: String(payload.email ?? ""),
      orgId: typeof payload.orgId === "string" ? payload.orgId : null,
      role: typeof payload.role === "string" ? (payload.role as MemberRole) : null,
    };
    await ensureShadowRows(session);
    return session;
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(`${authServiceUrl()}/login`);
  return session;
}

export type RoleCheckResult =
  | { ok: true; session: Session }
  | { ok: false; session: Session | null; reason: "unauthenticated" | "forbidden" };

export async function requireRole(min: MemberRole): Promise<RoleCheckResult> {
  const session = await getSession();
  if (!session) return { ok: false, session: null, reason: "unauthenticated" };
  if (!session.role || ROLE_RANK[session.role] < ROLE_RANK[min]) {
    return { ok: false, session, reason: "forbidden" };
  }
  return { ok: true, session };
}

export type ApiRoleCheckResult = { ok: true; session: Session } | { ok: false; response: NextResponse };

export async function requireApiRole(min: MemberRole): Promise<ApiRoleCheckResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!session.role || ROLE_RANK[session.role] < ROLE_RANK[min]) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, session };
}
```

Note: `redirect()` from `next/navigation` throws a framework-internal signal Next.js handles specially
— it is not a regular error and is never caught by an error boundary, so `requireSession` is safe to
use directly in Server Components/Server Actions.

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd ads-agent && npx vitest run lib/auth/dal.test.ts
```

- [ ] **Step 6: Write the failing test — `ads-agent/middleware.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return actual;
});

process.env.AUTH_SERVICE_URL = "http://localhost:3040";

import { NextRequest } from "next/server";
import { middleware } from "./middleware";

describe("middleware", () => {
  it("redirects to auth-service login when there is no gs_session cookie", () => {
    const req = new NextRequest("http://localhost:3030/campaigns");
    const res = middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3040/login?return_to=http%3A%2F%2Flocalhost%3A3030%2Fcampaigns",
    );
  });

  it("passes the request through when a gs_session cookie is present", () => {
    const req = new NextRequest("http://localhost:3030/campaigns", {
      headers: { cookie: "gs_session=some-token" },
    });
    const res = middleware(req);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 7: Run test — expect FAIL**

```bash
cd ads-agent && npx vitest run middleware.test.ts
```

- [ ] **Step 8: Implement `ads-agent/middleware.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";

// UX convenience only — NOT the security boundary (see plan's Global Constraints re: CVE-2025-29927).
// Every protected page/action/route still calls requireSession/requireRole/requireApiRole itself.
export function middleware(request: NextRequest): NextResponse {
  if (request.cookies.has("gs_session")) return NextResponse.next();

  const authServiceUrl = process.env.AUTH_SERVICE_URL ?? "http://localhost:3040";
  const returnTo = encodeURIComponent(request.nextUrl.href);
  return NextResponse.redirect(`${authServiceUrl}/login?return_to=${returnTo}`);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 9: Run test — expect PASS**

```bash
cd ads-agent && npx vitest run middleware.test.ts
```

- [ ] **Step 10: `ads-agent/components/ForbiddenNotice.tsx`** (shared inline "no access" UI for Server
  Components that get `{ ok: false, reason: "forbidden" }` back from `requireRole`)

```tsx
export function ForbiddenNotice() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
      <p className="text-lg font-semibold text-foreground">You don&apos;t have access to this page</p>
      <p className="text-sm text-muted-foreground">Ask an admin if you believe this is a mistake.</p>
    </div>
  );
}
```

- [ ] **Step 11: Full test run + typecheck**

```bash
cd ads-agent
npx vitest run lib/auth/dal.test.ts middleware.test.ts
npx tsc --noEmit
```

- [ ] **Step 12: Commit**

```bash
git add ads-agent/package.json ads-agent/package-lock.json ads-agent/lib/auth \
  ads-agent/middleware.ts ads-agent/middleware.test.ts ads-agent/components/ForbiddenNotice.tsx
git commit -m "$(cat <<'EOF'
feat(ads-agent): add JWT-verifying auth DAL and UX-redirect middleware

EOF
)"
```

---

### Task 4: Deployment — `deploy/Caddyfile` + `deploy/docker-compose.prod.yml`

**Files:**
- Modify: `deploy/Caddyfile`
- Modify: `deploy/docker-compose.prod.yml`

**Interfaces:**
- Consumes: nothing (pure config).
- Produces: nothing consumed by other tasks (deployment-only; the running services this points at are
  built by Tasks 1-11, but the config itself has zero code dependency).

- [ ] **Step 1: Read the current files**

```bash
cat deploy/Caddyfile
cat deploy/docker-compose.prod.yml
```

- [ ] **Step 2: Add reverse-proxy blocks to `deploy/Caddyfile`**

Append after the existing `crm.gentlespacesolutions.com` block:

```caddyfile
# auth-service — Google SSO + RBAC identity provider for the admin portal.
auth.gentlespacesolutions.com {
	reverse_proxy auth:3040
}

# ads-agent admin portal — now behind real authentication (see
# docs/superpowers/specs/2026-08-04-rbac-auth-service-design.md).
ads.gentlespacesolutions.com {
	reverse_proxy ads-agent:3030
}
```

- [ ] **Step 3: Add services to `deploy/docker-compose.prod.yml`**

The existing file only augments `caddy`'s networks (the `web`/`ads-agent` app containers live in their
own compose files per the existing pattern — see `infra/twenty/docker-compose.prod.yml` for precedent).
Add sibling service stubs here that reference the same pattern, wired onto `caddy`'s network:

```yaml
services:
  caddy:
    networks:
      - default
      - twenty_default

  auth:
    build: ../auth-service
    environment:
      DATABASE_URL: ${AUTH_DATABASE_URL}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      AUTH_SECRET: ${AUTH_SECRET}
      AUTH_TRUST_HOST: "true"
      AUTH_JWT_PRIVATE_KEY_PEM: ${AUTH_JWT_PRIVATE_KEY_PEM}
      AUTH_JWT_PUBLIC_KEY_PEM: ${AUTH_JWT_PUBLIC_KEY_PEM}
      AUTH_JWT_KID: auth-service-key-1
      ADMIN_BOOTSTRAP_EMAILS: ${ADMIN_BOOTSTRAP_EMAILS}
      INTERNAL_API_KEY: ${INTERNAL_API_KEY}
      COOKIE_DOMAIN: .gentlespacesolutions.com
    restart: unless-stopped

  auth-db:
    image: postgres:16
    environment:
      POSTGRES_DB: auth_service
      POSTGRES_USER: auth_service
      POSTGRES_PASSWORD: ${AUTH_DB_PASSWORD}
    volumes:
      - auth-db-data:/var/lib/postgresql/data
    restart: unless-stopped

  ads-agent:
    build: ../ads-agent
    environment:
      DATABASE_URL: ${ADS_AGENT_DATABASE_URL}
      AUTH_SERVICE_URL: https://auth.gentlespacesolutions.com
      AUTH_SERVICE_INTERNAL_API_KEY: ${INTERNAL_API_KEY}
      # ...existing ads-agent env vars (Bifrost, Google Ads, Meta, Twenty) unchanged, see
      # ads-agent/.env.example
    restart: unless-stopped

networks:
  twenty_default:
    external: true

volumes:
  auth-db-data:
```

The `ads-agent` service block here is illustrative of the two new env vars it needs
(`AUTH_SERVICE_URL`, `AUTH_SERVICE_INTERNAL_API_KEY`) layered onto its existing production env — if
`ads-agent` doesn't already have its own service block in this file, add one; if it does (check the
file read in Step 1), merge these two new environment entries into the existing block instead of
duplicating it.

- [ ] **Step 4: Commit**

```bash
git add deploy/Caddyfile deploy/docker-compose.prod.yml
git commit -m "$(cat <<'EOF'
feat(deploy): expose auth-service and ads-agent on public subdomains

EOF
)"
```

---

### Task 5: `ads-agent/lib/auth/internal-client.ts` + tests

**Files:**
- Create: `ads-agent/lib/auth/internal-client.ts`
- Create: `ads-agent/lib/auth/internal-client.test.ts`

**Interfaces:**
- Consumes: nothing (calls `auth-service`'s internal API over HTTP per the documented contract — no
  intra-repo import of `auth-service` code exists or should exist).
- Produces (consumed by Task 11): `listOrgMembers(): Promise<{members, pending}>`,
  `assignRole(userId, role): Promise<void>`, `MemberRole` type (duplicated from `../auth/dal.ts`'s
  identical 3-line type alias — intentional, see Global Constraints on cross-service type duplication).

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listOrgMembers, assignRole } from "./internal-client";

const originalFetch = global.fetch;

beforeEach(() => {
  process.env.AUTH_SERVICE_URL = "http://localhost:3040";
  process.env.AUTH_SERVICE_INTERNAL_API_KEY = "test-key";
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("listOrgMembers", () => {
  it("GETs /internal/org-members with the internal api key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ members: [], pending: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await listOrgMembers();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3040/internal/org-members",
      expect.objectContaining({ headers: { "x-internal-api-key": "test-key" } }),
    );
    expect(result).toEqual({ members: [], pending: [] });
  });

  it("throws when the response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
    await expect(listOrgMembers()).rejects.toThrow(/401/);
  });
});

describe("assignRole", () => {
  it("POSTs userId + role with the internal api key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await assignRole("u-1", "operator");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3040/internal/org-members",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-api-key": "test-key" },
        body: JSON.stringify({ userId: "u-1", role: "operator" }),
      }),
    );
  });

  it("throws when the response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 }) as unknown as typeof fetch;
    await expect(assignRole("u-1", "admin")).rejects.toThrow(/400/);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd ads-agent && npx vitest run lib/auth/internal-client.test.ts
```

- [ ] **Step 3: Implement `ads-agent/lib/auth/internal-client.ts`**

```ts
// Duplicated from ../auth/dal.ts intentionally — see plan's Global Constraints on cross-service type
// duplication (this file talks to auth-service purely over HTTP, never imports its code).
export type MemberRole = "admin" | "operator" | "viewer";

export type OrgMember = {
  userId: string;
  email: string;
  name: string | null;
  role: MemberRole;
  lastLoginAt: string | null;
};
export type PendingUser = { userId: string; email: string; name: string | null };

function authServiceUrl(): string {
  const url = process.env.AUTH_SERVICE_URL;
  if (!url) throw new Error("AUTH_SERVICE_URL is not set");
  return url;
}

function internalApiKey(): string {
  const key = process.env.AUTH_SERVICE_INTERNAL_API_KEY;
  if (!key) throw new Error("AUTH_SERVICE_INTERNAL_API_KEY is not set");
  return key;
}

export async function listOrgMembers(): Promise<{ members: OrgMember[]; pending: PendingUser[] }> {
  const res = await fetch(`${authServiceUrl()}/internal/org-members`, {
    headers: { "x-internal-api-key": internalApiKey() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`auth-service internal API error: ${res.status}`);
  return res.json();
}

export async function assignRole(userId: string, role: MemberRole): Promise<void> {
  const res = await fetch(`${authServiceUrl()}/internal/org-members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-api-key": internalApiKey() },
    body: JSON.stringify({ userId, role }),
  });
  if (!res.ok) throw new Error(`auth-service internal API error: ${res.status}`);
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd ads-agent && npx vitest run lib/auth/internal-client.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/auth/internal-client.ts ads-agent/lib/auth/internal-client.test.ts
git commit -m "$(cat <<'EOF'
feat(ads-agent): add internal API client for auth-service role assignment

EOF
)"
```

---

### Task 6: `auth-service` Auth.js + login page + bridge route + bootstrap

**Files:**
- Create: `auth-service/auth.ts`
- Create: `auth-service/app/api/auth/[...nextauth]/route.ts`
- Create: `auth-service/app/login/page.tsx`
- Create: `auth-service/app/bridge/route.ts`
- Create: `auth-service/app/bridge/route.test.ts`
- Create: `auth-service/lib/rate-limit.ts`, `auth-service/lib/rate-limit.test.ts`

**Interfaces:**
- Consumes: `findOrCreateUserByGoogle`, `touchLastLogin` from `lib/db/users` (Task 1);
  `getMembership`, `upsertMembership`, `INTERNAL_ORG_ID` from `lib/db/org-members` (Task 1);
  `createRefreshToken` from `lib/db/refresh-tokens` (Task 1); `safeReturnTo` from `lib/safe-redirect`
  (Task 1); `mintAccessToken` from `lib/jwt` (Task 2). Requires `next-auth` — installed in Step 1.
- Produces: nothing consumed by later tasks (this is the login-flow entry point; Task 7's refresh
  route is a sibling, not a consumer of this task's files).

- [ ] **Step 1: Install `next-auth`**

```bash
cd auth-service
npm install next-auth
```

- [ ] **Step 2: `auth-service/auth.ts`** — Auth.js v5 config, Google provider only, **no adapter**
  (Auth.js's own session is used only transiently by the `bridge` route below to read the Google
  profile; `auth-service` owns 100% of persistence itself)

```ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: {
    async jwt({ token, profile }) {
      if (profile) {
        token.googleSub = profile.sub as string;
        token.email = profile.email as string;
        token.name = (profile.name as string | undefined) ?? null;
        token.picture = (profile.picture as string | undefined) ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      return {
        ...session,
        googleSub: token.googleSub as string | undefined,
      };
    },
  },
});
```

- [ ] **Step 3: `auth-service/app/api/auth/[...nextauth]/route.ts`**

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 4: Write the failing tests — `auth-service/lib/rate-limit.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T00:00:00.000Z"));
  });

  it("allows the first N requests within the window", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("1.2.3.4", 5, 10_000)).toBe(true);
    }
  });

  it("blocks the (N+1)th request within the same window", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("5.6.7.8", 5, 10_000);
    expect(checkRateLimit("5.6.7.8", 5, 10_000)).toBe(false);
  });

  it("resets after the window elapses", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("9.9.9.9", 5, 10_000);
    expect(checkRateLimit("9.9.9.9", 5, 10_000)).toBe(false);
    vi.advanceTimersByTime(10_001);
    expect(checkRateLimit("9.9.9.9", 5, 10_000)).toBe(true);
  });

  it("tracks different keys independently", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("aaa", 5, 10_000);
    expect(checkRateLimit("bbb", 5, 10_000)).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests — expect FAIL**

```bash
cd auth-service && npx vitest run lib/rate-limit.test.ts
```

- [ ] **Step 6: Implement `auth-service/lib/rate-limit.ts`**

```ts
/**
 * ponytail: single-process in-memory sliding window. Ceiling: doesn't survive a restart and doesn't
 * coordinate across multiple instances. Upgrade path: swap in @upstash/ratelimit + Upstash Redis if
 * auth-service is ever horizontally scaled — not needed at current single-instance admin-portal scale.
 */
const hits = new Map<string, number[]>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (timestamps.length >= limit) {
    hits.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  hits.set(key, timestamps);
  return true;
}
```

- [ ] **Step 7: Run tests — expect PASS**

```bash
cd auth-service && npx vitest run lib/rate-limit.test.ts
```

- [ ] **Step 8: `auth-service/app/login/page.tsx`**

```tsx
import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const { return_to } = await searchParams;
  const returnTo = return_to ?? "/";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-xl font-semibold">Gentle Space Admin</h1>
      <p className="max-w-sm text-sm text-gray-500">
        Sign in with your Google account. New accounts need an admin to grant access before you can
        use the dashboard.
      </p>
      <form
        action={async () => {
          "use server";
          await signIn("google", {
            redirectTo: `/bridge?return_to=${encodeURIComponent(returnTo)}`,
          });
        }}
      >
        <button
          type="submit"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
        >
          Sign in with Google
        </button>
      </form>
    </div>
  );
}
```

The `redirectTo` here (`/bridge?return_to=...`) is always a relative path on `auth-service` itself, so
it needs no `safeReturnTo` check — Auth.js already restricts `redirectTo` to same-origin URLs. The
`return_to` value it carries (the *cross-service* destination) is what `bridge/route.ts` validates
below.

- [ ] **Step 9: Write the failing tests — `auth-service/app/bridge/route.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: authMock }));

const findOrCreateUserByGoogle = vi.fn();
const touchLastLogin = vi.fn();
vi.mock("@/lib/db/users", () => ({ findOrCreateUserByGoogle, touchLastLogin }));

const getMembership = vi.fn();
const upsertMembership = vi.fn();
vi.mock("@/lib/db/org-members", () => ({
  getMembership,
  upsertMembership,
  INTERNAL_ORG_ID: "00000000-0000-0000-0000-000000000001",
}));

const createRefreshToken = vi.fn();
vi.mock("@/lib/db/refresh-tokens", () => ({ createRefreshToken }));

const mintAccessToken = vi.fn();
vi.mock("@/lib/jwt", () => ({ mintAccessToken }));

process.env.COOKIE_DOMAIN = "localhost";
process.env.ADMIN_BOOTSTRAP_EMAILS = "admin@gentlespacesolutions.com";

import { GET } from "./route";

beforeEach(() => {
  authMock.mockReset();
  findOrCreateUserByGoogle.mockReset();
  touchLastLogin.mockReset();
  getMembership.mockReset();
  upsertMembership.mockReset();
  createRefreshToken.mockReset();
  mintAccessToken.mockReset();
  createRefreshToken.mockResolvedValue("raw-refresh-token");
  mintAccessToken.mockResolvedValue("signed-jwt");
});

describe("GET /bridge", () => {
  it("redirects to /login when there is no Auth.js session yet", async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost:3040/bridge"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3040/login");
  });

  it("auto-grants admin on first login for a bootstrap email, then sets cookies", async () => {
    authMock.mockResolvedValue({
      googleSub: "g-1",
      user: { email: "admin@gentlespacesolutions.com", name: "Admin", image: null },
    });
    findOrCreateUserByGoogle.mockResolvedValue({
      id: "u-1",
      email: "admin@gentlespacesolutions.com",
      name: "Admin",
      avatarUrl: null,
    });
    getMembership.mockResolvedValue(null);

    const res = await GET(
      new Request("http://localhost:3040/bridge?return_to=" + encodeURIComponent("http://localhost:3030/")),
    );

    expect(upsertMembership).toHaveBeenCalledWith({
      orgId: "00000000-0000-0000-0000-000000000001",
      userId: "u-1",
      role: "admin",
      invitedBy: null,
    });
    expect(mintAccessToken).toHaveBeenCalledWith({
      sub: "u-1",
      email: "admin@gentlespacesolutions.com",
      orgId: "00000000-0000-0000-0000-000000000001",
      role: "admin",
    });
    expect(res.headers.get("set-cookie")).toContain("gs_session=signed-jwt");
    expect(res.headers.get("set-cookie")).toContain("gs_refresh=raw-refresh-token");
    expect(res.headers.get("location")).toBe("http://localhost:3030/");
  });

  it("leaves a non-bootstrap first-time user pending (orgId/role null)", async () => {
    authMock.mockResolvedValue({
      googleSub: "g-2",
      user: { email: "someone@gmail.com", name: "Someone", image: null },
    });
    findOrCreateUserByGoogle.mockResolvedValue({
      id: "u-2",
      email: "someone@gmail.com",
      name: "Someone",
      avatarUrl: null,
    });
    getMembership.mockResolvedValue(null);

    await GET(new Request("http://localhost:3040/bridge"));

    expect(upsertMembership).not.toHaveBeenCalled();
    expect(mintAccessToken).toHaveBeenCalledWith({
      sub: "u-2",
      email: "someone@gmail.com",
      orgId: null,
      role: null,
    });
  });

  it("mints with the existing membership for a returning member", async () => {
    authMock.mockResolvedValue({
      googleSub: "g-3",
      user: { email: "operator@gmail.com", name: "Op", image: null },
    });
    findOrCreateUserByGoogle.mockResolvedValue({
      id: "u-3",
      email: "operator@gmail.com",
      name: "Op",
      avatarUrl: null,
    });
    getMembership.mockResolvedValue({ orgId: "00000000-0000-0000-0000-000000000001", role: "operator" });

    await GET(new Request("http://localhost:3040/bridge"));

    expect(upsertMembership).not.toHaveBeenCalled();
    expect(mintAccessToken).toHaveBeenCalledWith({
      sub: "u-3",
      email: "operator@gmail.com",
      orgId: "00000000-0000-0000-0000-000000000001",
      role: "operator",
    });
  });
});
```

- [ ] **Step 10: Run tests — expect FAIL**

```bash
cd auth-service && npx vitest run app/bridge/route.test.ts
```

- [ ] **Step 11: Implement `auth-service/app/bridge/route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { findOrCreateUserByGoogle, touchLastLogin } from "@/lib/db/users";
import { getMembership, upsertMembership, INTERNAL_ORG_ID } from "@/lib/db/org-members";
import { createRefreshToken } from "@/lib/db/refresh-tokens";
import { mintAccessToken } from "@/lib/jwt";
import { safeReturnTo } from "@/lib/safe-redirect";

function bootstrapEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_BOOTSTRAP_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const session = await auth();

  if (!session?.googleSub || !session.user?.email) {
    return NextResponse.redirect(new URL("/login", url));
  }

  const user = await findOrCreateUserByGoogle({
    googleSub: session.googleSub,
    email: session.user.email,
    name: session.user.name ?? null,
    avatarUrl: session.user.image ?? null,
  });
  await touchLastLogin(user.id);

  let membership = await getMembership(user.id);
  if (!membership && bootstrapEmails().has(user.email.toLowerCase())) {
    await upsertMembership({ orgId: INTERNAL_ORG_ID, userId: user.id, role: "admin", invitedBy: null });
    membership = { orgId: INTERNAL_ORG_ID, role: "admin" };
  }

  const accessToken = await mintAccessToken({
    sub: user.id,
    email: user.email,
    orgId: membership?.orgId ?? null,
    role: membership?.role ?? null,
  });
  const refreshToken = await createRefreshToken(user.id);

  const cookieDomain = process.env.COOKIE_DOMAIN ?? "localhost";
  const destination = safeReturnTo(url.searchParams.get("return_to"), url.origin, cookieDomain);

  const res = NextResponse.redirect(destination);
  res.cookies.set("gs_session", accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    domain: cookieDomain,
    path: "/",
    maxAge: 20 * 60,
  });
  res.cookies.set("gs_refresh", refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
```

- [ ] **Step 12: Run tests — expect PASS**

```bash
cd auth-service && npx vitest run app/bridge/route.test.ts
```

- [ ] **Step 13: Typecheck**

```bash
cd auth-service && npx tsc --noEmit
```

If Auth.js v5's actual installed type signatures for `callbacks.session`/`callbacks.jwt` or the
`auth()` return shape differ slightly from what's used above (v5 has iterated its API across betas),
adjust to match — check `node_modules/next-auth/README.md` and the installed package's `.d.ts` files
for the exact current signatures rather than guessing further; the *behavior* (stash `googleSub` on
first sign-in, read it back in `bridge/route.ts`) is what must be preserved.

- [ ] **Step 14: Commit**

```bash
git add auth-service/package.json auth-service/package-lock.json auth-service/auth.ts \
  auth-service/app/api auth-service/app/login auth-service/app/bridge \
  auth-service/lib/rate-limit.ts auth-service/lib/rate-limit.test.ts
git commit -m "$(cat <<'EOF'
feat(auth-service): add Google login, JIT provisioning, and bootstrap admin

EOF
)"
```

---

### Task 7: `auth-service` JWKS + refresh routes

**Files:**
- Create: `auth-service/app/api/jwks/route.ts`
- Create: `auth-service/app/api/jwks/route.test.ts`
- Create: `auth-service/app/api/refresh/route.ts`
- Create: `auth-service/app/api/refresh/route.test.ts`

**Interfaces:**
- Consumes: `getJwks`, `mintAccessToken` from `lib/jwt` (Task 2); `rotateRefreshToken` from
  `lib/db/refresh-tokens` (Task 1); `findUserById` from `lib/db/users` (Task 1); `getMembership` from
  `lib/db/org-members` (Task 1); `safeReturnTo` from `lib/safe-redirect` (Task 1).
- Produces: `GET /.well-known/jwks.json` (via the Task 1 rewrite) and `GET /api/refresh`, both consumed
  externally by `ads-agent` (Task 3's `getJwks()` remote fetch, and the not-yet-built client-side
  silent-refresh redirect respectively) — no other task in this plan imports these files directly.

- [ ] **Step 1: Write the failing test — `auth-service/app/api/jwks/route.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";

const getJwks = vi.fn();
vi.mock("@/lib/jwt", () => ({ getJwks }));

import { GET } from "./route";

describe("GET /api/jwks", () => {
  it("returns the JWKS document from lib/jwt with a cache header", async () => {
    getJwks.mockResolvedValue({ keys: [{ kid: "k1" }] });
    const res = await GET();
    expect(await res.json()).toEqual({ keys: [{ kid: "k1" }] });
    expect(res.headers.get("cache-control")).toContain("max-age");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd auth-service && npx vitest run app/api/jwks/route.test.ts
```

- [ ] **Step 3: Implement `auth-service/app/api/jwks/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getJwks } from "@/lib/jwt";

export async function GET() {
  const jwks = await getJwks();
  return NextResponse.json(jwks, { headers: { "Cache-Control": "public, max-age=300" } });
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd auth-service && npx vitest run app/api/jwks/route.test.ts
```

- [ ] **Step 5: Write the failing tests — `auth-service/app/api/refresh/route.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const rotateRefreshToken = vi.fn();
vi.mock("@/lib/db/refresh-tokens", () => ({ rotateRefreshToken }));

const findUserById = vi.fn();
vi.mock("@/lib/db/users", () => ({ findUserById }));

const getMembership = vi.fn();
vi.mock("@/lib/db/org-members", () => ({ getMembership }));

const mintAccessToken = vi.fn();
vi.mock("@/lib/jwt", () => ({ mintAccessToken }));

process.env.COOKIE_DOMAIN = "localhost";

import { GET } from "./route";

beforeEach(() => {
  rotateRefreshToken.mockReset();
  findUserById.mockReset();
  getMembership.mockReset();
  mintAccessToken.mockReset();
  mintAccessToken.mockResolvedValue("new-signed-jwt");
});

function requestWithRefreshCookie(cookieValue: string | null, returnTo?: string) {
  const url = new URL("http://localhost:3040/api/refresh");
  if (returnTo) url.searchParams.set("return_to", returnTo);
  const headers = new Headers();
  if (cookieValue) headers.set("cookie", `gs_refresh=${cookieValue}`);
  return new Request(url, { headers });
}

describe("GET /api/refresh", () => {
  it("redirects to /login when there is no gs_refresh cookie", async () => {
    const res = await GET(requestWithRefreshCookie(null));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("redirects to /login when the refresh token doesn't rotate (expired/revoked/missing)", async () => {
    rotateRefreshToken.mockResolvedValue(null);
    const res = await GET(requestWithRefreshCookie("stale-token"));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("mints a fresh access token and rotates the refresh cookie on success", async () => {
    rotateRefreshToken.mockResolvedValue({ userId: "u-1", newRawToken: "new-refresh-token" });
    findUserById.mockResolvedValue({ id: "u-1", email: "a@x.com", name: null, avatarUrl: null });
    getMembership.mockResolvedValue({ orgId: "org-1", role: "operator" });

    const res = await GET(requestWithRefreshCookie("valid-token", "http://localhost:3030/campaigns"));

    expect(mintAccessToken).toHaveBeenCalledWith({
      sub: "u-1",
      email: "a@x.com",
      orgId: "org-1",
      role: "operator",
    });
    expect(res.headers.get("set-cookie")).toContain("gs_session=new-signed-jwt");
    expect(res.headers.get("set-cookie")).toContain("gs_refresh=new-refresh-token");
    expect(res.headers.get("location")).toBe("http://localhost:3030/campaigns");
  });
});
```

- [ ] **Step 6: Run tests — expect FAIL**

```bash
cd auth-service && npx vitest run app/api/refresh/route.test.ts
```

- [ ] **Step 7: Implement `auth-service/app/api/refresh/route.ts`**

```ts
import { NextResponse } from "next/server";
import { rotateRefreshToken } from "@/lib/db/refresh-tokens";
import { findUserById } from "@/lib/db/users";
import { getMembership } from "@/lib/db/org-members";
import { mintAccessToken } from "@/lib/jwt";
import { safeReturnTo } from "@/lib/safe-redirect";

function extractRefreshCookie(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)gs_refresh=([^;]+)/);
  return match ? match[1] : null;
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const cookieDomain = process.env.COOKIE_DOMAIN ?? "localhost";
  const returnTo = safeReturnTo(url.searchParams.get("return_to"), url.origin, cookieDomain);
  const loginUrl = new URL(`/login?return_to=${encodeURIComponent(returnTo)}`, url.origin);

  const rawRefresh = extractRefreshCookie(req);
  if (!rawRefresh) return NextResponse.redirect(loginUrl);

  const rotated = await rotateRefreshToken(rawRefresh);
  if (!rotated) return NextResponse.redirect(loginUrl);

  const user = await findUserById(rotated.userId);
  if (!user) return NextResponse.redirect(loginUrl);

  const membership = await getMembership(user.id);
  const accessToken = await mintAccessToken({
    sub: user.id,
    email: user.email,
    orgId: membership?.orgId ?? null,
    role: membership?.role ?? null,
  });

  const res = NextResponse.redirect(returnTo);
  res.cookies.set("gs_session", accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    domain: cookieDomain,
    path: "/",
    maxAge: 20 * 60,
  });
  res.cookies.set("gs_refresh", rotated.newRawToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
```

- [ ] **Step 8: Run tests — expect PASS**

```bash
cd auth-service && npx vitest run app/api/refresh/route.test.ts
```

- [ ] **Step 9: Typecheck**

```bash
cd auth-service && npx tsc --noEmit
```

- [ ] **Step 10: Commit**

```bash
git add auth-service/app/api/jwks auth-service/app/api/refresh
git commit -m "$(cat <<'EOF'
feat(auth-service): add JWKS endpoint and silent-refresh route

EOF
)"
```

---

### Task 8: `auth-service` internal org-members API

**Files:**
- Create: `auth-service/app/internal/org-members/route.ts`
- Create: `auth-service/app/internal/org-members/route.test.ts`

**Interfaces:**
- Consumes: `listMembers`, `listPendingUsers`, `upsertMembership`, `INTERNAL_ORG_ID` from
  `lib/db/org-members` (Task 1); `MemberRole` from `lib/types` (Task 1).
- Produces: the HTTP contract `ads-agent`'s `lib/auth/internal-client.ts` (Task 5) already implements
  against — `GET /internal/org-members` → `{members, pending}`, `POST /internal/org-members` (body
  `{userId, role}`) → `{ok: true}`. No other task imports this file directly.

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const listMembers = vi.fn();
const listPendingUsers = vi.fn();
const upsertMembership = vi.fn();
vi.mock("@/lib/db/org-members", () => ({
  listMembers,
  listPendingUsers,
  upsertMembership,
  INTERNAL_ORG_ID: "00000000-0000-0000-0000-000000000001",
}));

process.env.INTERNAL_API_KEY = "test-key";

import { GET, POST } from "./route";

function req(method: string, opts: { apiKey?: string; body?: unknown } = {}): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (opts.apiKey !== undefined) headers.set("x-internal-api-key", opts.apiKey);
  return new Request("http://localhost:3040/internal/org-members", {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

beforeEach(() => {
  listMembers.mockReset();
  listPendingUsers.mockReset();
  upsertMembership.mockReset();
});

describe("GET /internal/org-members", () => {
  it("rejects a missing or wrong api key with 401", async () => {
    expect((await GET(req("GET"))).status).toBe(401);
    expect((await GET(req("GET", { apiKey: "wrong" }))).status).toBe(401);
  });

  it("returns members + pending on a valid key", async () => {
    listMembers.mockResolvedValue([{ userId: "u-1", email: "a@x.com", name: null, role: "admin", lastLoginAt: null }]);
    listPendingUsers.mockResolvedValue([{ userId: "u-2", email: "b@x.com", name: null }]);
    const res = await GET(req("GET", { apiKey: "test-key" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      members: [{ userId: "u-1", email: "a@x.com", name: null, role: "admin", lastLoginAt: null }],
      pending: [{ userId: "u-2", email: "b@x.com", name: null }],
    });
    expect(listMembers).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001");
  });
});

describe("POST /internal/org-members", () => {
  it("rejects a missing or wrong api key with 401", async () => {
    const res = await POST(req("POST", { body: { userId: "u-1", role: "admin" } }));
    expect(res.status).toBe(401);
  });

  it("rejects a missing userId with 400", async () => {
    const res = await POST(req("POST", { apiKey: "test-key", body: { role: "admin" } }));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid role with 400", async () => {
    const res = await POST(
      req("POST", { apiKey: "test-key", body: { userId: "u-1", role: "superadmin" } }),
    );
    expect(res.status).toBe(400);
  });

  it("assigns the role on a valid request", async () => {
    upsertMembership.mockResolvedValue(undefined);
    const res = await POST(req("POST", { apiKey: "test-key", body: { userId: "u-1", role: "operator" } }));
    expect(res.status).toBe(200);
    expect(upsertMembership).toHaveBeenCalledWith({
      orgId: "00000000-0000-0000-0000-000000000001",
      userId: "u-1",
      role: "operator",
      invitedBy: null,
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd auth-service && npx vitest run app/internal/org-members/route.test.ts
```

- [ ] **Step 3: Implement `auth-service/app/internal/org-members/route.ts`**

```ts
import { NextResponse } from "next/server";
import { listMembers, listPendingUsers, upsertMembership, INTERNAL_ORG_ID } from "@/lib/db/org-members";
import type { MemberRole } from "@/lib/types";

const VALID_ROLES: MemberRole[] = ["admin", "operator", "viewer"];

function isAuthorized(req: Request): boolean {
  const provided = req.headers.get("x-internal-api-key");
  const expected = process.env.INTERNAL_API_KEY;
  return Boolean(expected) && provided === expected;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [members, pending] = await Promise.all([listMembers(INTERNAL_ORG_ID), listPendingUsers()]);
  return NextResponse.json({ members, pending });
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json()) as { userId?: unknown; role?: unknown };
  if (typeof body.userId !== "string" || !body.userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (typeof body.role !== "string" || !VALID_ROLES.includes(body.role as MemberRole)) {
    return NextResponse.json({ error: "role must be one of admin, operator, viewer" }, { status: 400 });
  }
  await upsertMembership({
    orgId: INTERNAL_ORG_ID,
    userId: body.userId,
    role: body.role as MemberRole,
    invitedBy: null,
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd auth-service && npx vitest run app/internal/org-members/route.test.ts
```

- [ ] **Step 5: Typecheck + commit**

```bash
cd auth-service && npx tsc --noEmit
git add auth-service/app/internal
git commit -m "$(cat <<'EOF'
feat(auth-service): add internal org-members list/assign API

EOF
)"
```

---

### Task 9: `ads-agent` admin-only wiring — layout, `/credits`, `/settings`

**Files:**
- Modify: `ads-agent/app/(admin)/layout.tsx`
- Modify: `ads-agent/app/(admin)/credits/page.tsx`
- Modify: `ads-agent/app/(admin)/settings/page.tsx`
- Modify: `ads-agent/app/api/credits/grant/route.ts`
- Modify: `ads-agent/app/api/credits/grant/route.test.ts`

**Interfaces:**
- Consumes: `requireSession`, `requireRole`, `requireApiRole` from `../../lib/auth/dal` (Task 3);
  `ForbiddenNotice` from `../../components/ForbiddenNotice` (Task 3).
- Produces: nothing consumed by other tasks (leaf page/route wiring).

- [ ] **Step 1: Wire `(admin)/layout.tsx`** — call `requireSession()` once for the whole admin section;
  render the "pending approval" screen instead of the dashboard chrome when `role` is `null`

```tsx
import type { ReactNode } from "react";
import { getCronSettings } from "@/lib/db/settings";
import { cn } from "@/lib/utils";
import { requireSession } from "@/lib/auth/dal";
import { RunNowButton } from "@/components/RunNowButton";
import { SidebarNav } from "@/components/SidebarNav";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!session.role) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6 text-center">
        <div className="flex max-w-md flex-col gap-2">
          <p className="text-lg font-semibold text-foreground">Your account is pending approval</p>
          <p className="text-sm text-muted-foreground">
            Signed in as {session.email}. An admin needs to assign you a role from Usage &amp;
            Credits → Users before you can access the dashboard.
          </p>
        </div>
      </div>
    );
  }

  const settings = await getCronSettings();

  return (
    <div className="mx-auto grid min-h-dvh max-w-[1400px] grid-cols-[220px_1fr]">
      <aside className="border-r border-border">
        <div className="px-4 py-4 text-sm font-semibold tracking-tight">ads-agent</div>
        <SidebarNav />
      </aside>
      <div className="flex flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border px-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              className={cn(
                "inline-block size-2 rounded-full",
                settings.enabled ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
              aria-hidden
            />
            Cron: {settings.enabled ? "on" : "off"}
            <span className="text-muted-foreground/60">
              · Last run {settings.lastRunAt ? new Date(settings.lastRunAt).toLocaleString() : "never"}
            </span>
          </div>
          <RunNowButton />
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire `(admin)/credits/page.tsx` as admin-only** — replace the
  `DEFAULT_ORG_ID`-from-`dev-context` import with the session's `orgId`, guarded by `requireRole`

```tsx
import {
  getSpendByFeature,
  getSpendByModel,
  getSpendTrend,
  listMemberBalances,
  listOrgBalances,
} from "@/lib/db/credits";
import { requireRole } from "@/lib/auth/dal";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AllocateCreditsForm } from "./AllocateCreditsForm";
import { UsagePoller } from "./UsagePoller";

function formatCredits(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default async function CreditsPage() {
  const access = await requireRole("admin");
  if (!access.ok) return <ForbiddenNotice />;
  const orgId = access.session.orgId!;

  const [orgBalances, members, spendByFeature, spendByModel, trend] = await Promise.all([
    listOrgBalances(),
    listMemberBalances(orgId),
    getSpendByFeature(orgId, 30),
    getSpendByModel(orgId, 30),
    getSpendTrend(orgId, 30),
  ]);

  const org = orgBalances.find((o) => o.orgId === orgId);

  // ...rest of the JSX is unchanged from the existing page — only the DEFAULT_ORG_ID references
  // become `orgId` (the session-derived value above). Every `DEFAULT_ORG_ID` in the existing file
  // (org lookup, AllocateCreditsForm's orgId prop) becomes `orgId`.
}
```

Apply the same `DEFAULT_ORG_ID` → `orgId` substitution to every remaining reference in the file (the
`org?.balanceCredits` lookup and `<AllocateCreditsForm orgId={orgId} />`); the rest of the JSX body is
unchanged.

- [ ] **Step 3: Wire `(admin)/settings/page.tsx` as admin-only** — add the guard at the top, keep the
  rest of the existing page body unchanged

```tsx
import { getCronSettings } from "@/lib/db/settings";
import { getConnectorStatus } from "@/lib/env-status";
import { requireRole } from "@/lib/auth/dal";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsForm } from "./SettingsForm";

// ...existing CONNECTOR_LABELS constant unchanged...

export default async function SettingsPage() {
  const access = await requireRole("admin");
  if (!access.ok) return <ForbiddenNotice />;

  const settings = await getCronSettings();
  const connectorStatus = getConnectorStatus();

  // ...rest of the existing JSX body is unchanged...
}
```

- [ ] **Step 4: Wire `api/credits/grant/route.ts` as admin-only, deriving `orgId` from the session
  instead of trusting a client-submitted value**

```ts
import { NextResponse } from "next/server";
import { grantCredits } from "@/lib/metering/ledger";
import { requireApiRole } from "@/lib/auth/dal";

export async function POST(req: Request) {
  const access = await requireApiRole("admin");
  if (!access.ok) return access.response;

  const body = (await req.json()) as {
    userId?: unknown;
    amountCredits?: unknown;
    note?: unknown;
  };
  if (typeof body.amountCredits !== "number" || !(body.amountCredits > 0)) {
    return NextResponse.json({ error: "amountCredits must be a positive number" }, { status: 400 });
  }
  await grantCredits({
    orgId: access.session.orgId!,
    userId: typeof body.userId === "string" && body.userId ? body.userId : undefined,
    amountCredits: body.amountCredits,
    grantedBy: access.session.email,
    note: typeof body.note === "string" && body.note ? body.note : undefined,
  });
  return NextResponse.json({ ok: true });
}
```

Note `orgId` is no longer accepted from the request body at all — it always comes from the
authenticated admin's own session, closing the previously-open "anyone can allocate credits to any
org" hole. `grantedBy` is now the real admin's email instead of the hardcoded `"admin"` string.

- [ ] **Step 5: Update `api/credits/grant/route.test.ts`** to mock `requireApiRole` and derive `orgId`
  from the session instead of the request body

```ts
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const grantCredits = vi.fn();
vi.mock("@/lib/metering/ledger", () => ({ grantCredits }));

const requireApiRole = vi.fn();
vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));

import { POST } from "./route";

function req(body: unknown): Request {
  return new Request("http://localhost:3030/api/credits/grant", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  grantCredits.mockReset();
  requireApiRole.mockReset();
  requireApiRole.mockResolvedValue({
    ok: true,
    session: { orgId: "org-1", email: "admin@x.com", userId: "u-1", role: "admin" },
  });
});

describe("POST /api/credits/grant", () => {
  it("passes through the 401/403 response when requireApiRole rejects the caller", async () => {
    requireApiRole.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await POST(req({ amountCredits: 100 }));
    expect(res.status).toBe(403);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("rejects a non-positive amountCredits", async () => {
    const res = await POST(req({ amountCredits: 0 }));
    expect(res.status).toBe(400);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("grants credits to the session's orgId, ignoring any client-submitted orgId", async () => {
    const res = await POST(req({ orgId: "attacker-org", amountCredits: 100, note: "top-up" }));
    expect(res.status).toBe(200);
    expect(grantCredits).toHaveBeenCalledWith({
      orgId: "org-1",
      userId: undefined,
      amountCredits: 100,
      grantedBy: "admin@x.com",
      note: "top-up",
    });
  });
});
```

- [ ] **Step 6: Run tests, typecheck, and manually verify the layout renders**

```bash
cd ads-agent
npx vitest run app/api/credits/grant/route.test.ts
npx tsc --noEmit
```

(Full manual browser verification of the login→dashboard flow happens in Task 13, once Task 6's login
flow exists — this task's own verification is limited to types + the grant-route unit tests, since
`requireSession`/`requireRole` will redirect without a real cookie in a bare `npm run dev` at this
point in the plan.)

- [ ] **Step 7: Commit**

```bash
git add "ads-agent/app/(admin)/layout.tsx" "ads-agent/app/(admin)/credits/page.tsx" \
  "ads-agent/app/(admin)/settings/page.tsx" ads-agent/app/api/credits/grant/route.ts \
  ads-agent/app/api/credits/grant/route.test.ts
git commit -m "$(cat <<'EOF'
feat(ads-agent): require admin role for credits/settings and layout

EOF
)"
```

---

### Task 10: `ads-agent` operator+ wiring — campaigns, proposals, campaign-chat ctx

**Files:**
- Modify: `ads-agent/app/(admin)/campaigns/page.tsx`
- Modify: `ads-agent/app/(admin)/campaigns/new/page.tsx`
- Modify: `ads-agent/app/(admin)/campaigns/drafts/[id]/page.tsx`
- Modify: `ads-agent/app/(admin)/proposals/page.tsx`
- Modify: `ads-agent/app/(admin)/proposals/[id]/page.tsx`
- Modify: `ads-agent/lib/decision-engine/campaign-chat.ts`
- Modify: `ads-agent/lib/decision-engine/campaign-chat.test.ts`

**Interfaces:**
- Consumes: `requireRole`, `getSession` from `../../lib/auth/dal` (Task 3); `ForbiddenNotice` from
  `../../components/ForbiddenNotice` (Task 3).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Add the operator-role guard to each of the five pages** — the exact same 2-line
  insertion applies to every one: import `requireRole` + `ForbiddenNotice`, and as the first
  statement in the exported page component:

```tsx
const access = await requireRole("operator");
if (!access.ok) return <ForbiddenNotice />;
```

Apply this to `app/(admin)/campaigns/page.tsx`'s `CampaignsPage`, `app/(admin)/campaigns/new/page.tsx`'s
default export, `app/(admin)/campaigns/drafts/[id]/page.tsx`'s default export,
`app/(admin)/proposals/page.tsx`'s `ProposalsPage`, and `app/(admin)/proposals/[id]/page.tsx`'s default
export — in each file add the two imports at the top (adjusting the relative import depth, e.g.
`@/lib/auth/dal` and `@/components/ForbiddenNotice` work from any of these files via the existing `@/*`
alias) and the two guard lines as the first two lines inside the async function body, before any
existing `await` calls. Do not change anything else in these five files.

- [ ] **Step 2: Rewrite `campaign-chat.test.ts` to mock `getSession`**

Add a `getSession` mock alongside the existing `callMeteredChatCompletion` mock, resolving a fixed
session by default so every existing assertion about the `ctx` passed to `callMeteredChatCompletion`
keeps passing unchanged:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDraft } from "../types";

const callMeteredChatCompletion = vi.fn();
vi.mock("../metering/metered-client", () => ({ callMeteredChatCompletion }));

const getSession = vi.fn();
vi.mock("../auth/dal", () => ({ getSession }));

vi.mock("../bifrost/client", async () => {
  const actual = await vi.importActual<typeof import("../bifrost/client")>("../bifrost/client");
  return { ...actual, isBifrostConfigured: () => true };
});

// ...existing draft()/jsonResponse() helpers unchanged...

beforeEach(() => {
  callMeteredChatCompletion.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue({
    userId: "00000000-0000-0000-0000-000000000002",
    email: "operator@x.com",
    orgId: "00000000-0000-0000-0000-000000000001",
    role: "operator",
  });
});
```

Update the ctx assertion in the existing tests from
`expect(callMeteredChatCompletion.mock.calls[0][0]).toEqual({ orgId: DEFAULT_ORG_ID, userId:
DEFAULT_USER_ID, feature: "ads-agent:campaign-chat" })` to
`expect(callMeteredChatCompletion.mock.calls[0][0]).toEqual({ orgId:
"00000000-0000-0000-0000-000000000001", userId: "00000000-0000-0000-0000-000000000002", feature:
"ads-agent:campaign-chat" })`, and drop the now-unused `DEFAULT_ORG_ID`/`DEFAULT_USER_ID` import. Add
one new case:

```ts
it("falls back to the dev-context identity when there is no session (e.g. a direct script call)", async () => {
  getSession.mockResolvedValue(null);
  callMeteredChatCompletion.mockResolvedValue(jsonResponse({ headlines: ["H1"], descriptions: [] }));
  await import("./campaign-chat").then((m) => m.draftCampaignChatReply({ draft: draft(), history: [], userMessage: "hi" }));
  expect(callMeteredChatCompletion.mock.calls[0][0]).toMatchObject({
    orgId: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-000000000002",
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd ads-agent && npx vitest run lib/decision-engine/campaign-chat.test.ts
```

- [ ] **Step 4: Update `campaign-chat.ts`'s ctx construction**

```ts
import { getSession } from "../auth/dal";

// ...existing imports (DEFAULT_ORG_ID, DEFAULT_USER_ID from "../metering/dev-context") stay — they're
// now only the fallback for the rare case draftCampaignChatReply is invoked without a session (e.g. a
// future cron/script path), not the everyday path.
```

Replace the existing ctx construction:

```ts
const ctx: MeteringContext = {
  orgId: DEFAULT_ORG_ID,
  userId: DEFAULT_USER_ID,
  feature: "ads-agent:campaign-chat",
};
```

with:

```ts
const session = await getSession();
const ctx: MeteringContext = {
  orgId: session?.orgId ?? DEFAULT_ORG_ID,
  userId: session?.userId ?? DEFAULT_USER_ID,
  feature: "ads-agent:campaign-chat",
};
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd ads-agent && npx vitest run lib/decision-engine/campaign-chat.test.ts
```

- [ ] **Step 6: Typecheck**

```bash
cd ads-agent && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add "ads-agent/app/(admin)/campaigns" "ads-agent/app/(admin)/proposals" \
  ads-agent/lib/decision-engine/campaign-chat.ts ads-agent/lib/decision-engine/campaign-chat.test.ts
git commit -m "$(cat <<'EOF'
feat(ads-agent): require operator role for campaigns/proposals and chat

EOF
)"
```

---

### Task 11: `ads-agent` `/(admin)/users` page + sidebar entry

**Files:**
- Create: `ads-agent/app/(admin)/users/page.tsx`
- Create: `ads-agent/app/(admin)/users/AssignRoleForm.tsx`
- Create: `ads-agent/app/(admin)/users/actions.ts`
- Modify: `ads-agent/components/SidebarNav.tsx`

**Interfaces:**
- Consumes: `requireRole` from `@/lib/auth/dal` (Task 3); `listOrgMembers`, `assignRole`, `MemberRole`
  from `@/lib/auth/internal-client` (Task 5) — the actual HTTP calls hit Task 8's now-deployed route.
- Produces: nothing consumed by other tasks (leaf UI).

- [ ] **Step 1: `ads-agent/app/(admin)/users/actions.ts`** (Server Action, admin-only)

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/dal";
import { assignRole, type MemberRole } from "@/lib/auth/internal-client";

const VALID_ROLES: MemberRole[] = ["admin", "operator", "viewer"];

export async function assignRoleAction(userId: string, role: string): Promise<void> {
  const access = await requireRole("admin");
  if (!access.ok) throw new Error("Forbidden");
  if (!VALID_ROLES.includes(role as MemberRole)) throw new Error("Invalid role");

  await assignRole(userId, role as MemberRole);
  revalidatePath("/users");
}
```

- [ ] **Step 2: `ads-agent/app/(admin)/users/AssignRoleForm.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { assignRoleAction } from "./actions";

const ROLES = ["admin", "operator", "viewer"] as const;

export function AssignRoleForm({ userId, currentRole }: { userId: string; currentRole: string | null }) {
  const [role, setRole] = useState(currentRole ?? "viewer");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await assignRoleAction(userId, role);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to assign role.");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="h-9 rounded-md border border-border bg-background px-2 text-sm"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <Button type="button" size="sm" disabled={pending} onClick={submit}>
        {pending ? "Saving…" : "Assign"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: `ads-agent/app/(admin)/users/page.tsx`**

```tsx
import { requireRole } from "@/lib/auth/dal";
import { listOrgMembers } from "@/lib/auth/internal-client";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssignRoleForm } from "./AssignRoleForm";

export default async function UsersPage() {
  const access = await requireRole("admin");
  if (!access.ok) return <ForbiddenNotice />;

  const { members, pending } = await listOrgMembers();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Members</CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No members yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell className="font-medium text-foreground">{m.name ?? m.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{m.role}</Badge>
                    </TableCell>
                    <TableCell>
                      {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      <AssignRoleForm userId={m.userId} currentRole={m.role} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">
            Pending approval ({pending.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No pending sign-ins.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((p) => (
                  <TableRow key={p.userId}>
                    <TableCell className="font-medium text-foreground">{p.name ?? p.email}</TableCell>
                    <TableCell>
                      <AssignRoleForm userId={p.userId} currentRole={null} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Add the sidebar nav entry**

```ts
import { ClipboardList, CreditCard, LayoutDashboard, Megaphone, Settings as SettingsIcon, Users } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/proposals", label: "Proposals", icon: ClipboardList },
  { href: "/credits", label: "Usage & Credits", icon: CreditCard },
  { href: "/users", label: "Users", icon: Users },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];
```

- [ ] **Step 5: Typecheck**

```bash
cd ads-agent && npx tsc --noEmit
```

(No new unit tests in this task — it's a thin Server Component + Server Action over Task 5's already-
tested `internal-client.ts`; end-to-end verification happens in Task 13's manual smoke, since it needs
Task 8's route actually running.)

- [ ] **Step 6: Commit**

```bash
git add "ads-agent/app/(admin)/users" ads-agent/components/SidebarNav.tsx
git commit -m "$(cat <<'EOF'
feat(ads-agent): add Users admin page for role assignment

EOF
)"
```

---

### Task 12: Google OAuth Client + keypair setup runbook (docs only)

**Files:**
- Create: `auth-service/README.md`
- Create: `docs/superpowers/specs/2026-08-04-rbac-auth-service-runbook.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by other tasks (documentation only — but Task 13's manual smoke test
  depends on a human having followed this runbook to obtain real Google OAuth credentials, since that
  cannot be automated).

- [ ] **Step 1: `auth-service/README.md`**

```markdown
# auth-service

Google SSO + RBAC identity provider for the Gentle Space admin portal. See
[the design spec](../docs/superpowers/specs/2026-08-04-rbac-auth-service-design.md) for the full
architecture.

## Local development

\`\`\`bash
docker compose up -d db
cp .env.example .env.local   # fill in every var — see docs/superpowers/specs/2026-08-04-rbac-auth-service-runbook.md
npm install
npx tsx --env-file=.env.local lib/db/migrate.ts
npm run dev   # http://localhost:3040
\`\`\`

## Tests

\`\`\`bash
npx vitest run --env-file=.env.local
\`\`\`

(`--env-file=.env.local` is required for `lib/jwt.test.ts`, which signs/verifies real tokens against
the RS256 keypair in `.env.local`.)
```

- [ ] **Step 2: `docs/superpowers/specs/2026-08-04-rbac-auth-service-runbook.md`**

```markdown
# Runbook: Google OAuth Client + RS256 keypair setup

One-time manual setup required before `auth-service` can authenticate real users. Neither step can be
automated by an agent (both require a human with access to the Google Cloud Console / production
secrets store).

## 1. Google Cloud OAuth 2.0 Client

1. Open [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials.
2. Create Credentials → OAuth client ID → Application type **Web application**.
3. Authorized redirect URIs:
   - Production: `https://auth.gentlespacesolutions.com/api/auth/callback/google`
   - Local dev: `http://localhost:3040/api/auth/callback/google`
4. Copy the generated Client ID / Client Secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
   (`.env.local` for dev, the production secrets store for deploy — see Task 4's
   `docker-compose.prod.yml` env var names).
5. If this is a brand-new Google Cloud project, also enable the "Google People API" (used by the
   default OpenID Connect scopes for profile/email) under APIs & Services → Library.

## 2. RS256 keypair (the `gs_session` JWT signing key)

Generate once per environment (dev keypair and production keypair should differ):

\`\`\`bash
node -e "
const { generateKeyPairSync } = require('crypto');
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pub = publicKey.export({ type: 'spki', format: 'pem' });
console.log('AUTH_JWT_PRIVATE_KEY_PEM=' + priv.replace(/\n/g, '\\\\n'));
console.log('AUTH_JWT_PUBLIC_KEY_PEM=' + pub.replace(/\n/g, '\\\\n'));
"
\`\`\`

Store `AUTH_JWT_PRIVATE_KEY_PEM` as a production secret (never commit it). `AUTH_JWT_PUBLIC_KEY_PEM` is
not secret (it's served publicly at `/.well-known/jwks.json`), but keep both vars sourced the same way
for simplicity. `AUTH_JWT_KID` is any stable string identifier (e.g. `auth-service-key-1`) — bump it
only if you rotate to a new keypair (see the design spec's Non-goals re: manual-only key rotation).

## 3. `AUTH_SECRET` (Auth.js's own internal cookie encryption)

\`\`\`bash
openssl rand -base64 32
\`\`\`

## 4. `INTERNAL_API_KEY` (shared secret between `ads-agent` and `auth-service`)

Any random string is fine, e.g. \`openssl rand -hex 32\`. Set the same value as
`INTERNAL_API_KEY` in `auth-service` and `AUTH_SERVICE_INTERNAL_API_KEY` in `ads-agent`.

## 5. `ADMIN_BOOTSTRAP_EMAILS`

Comma-separated list of the Gmail address(es) that should become admin on their very first login
(e.g. your own Google Workspace email). Every role change after the first login happens through
`ads-agent`'s `/users` page (Task 11), not by editing this list again.
```

- [ ] **Step 3: Commit**

```bash
git add auth-service/README.md docs/superpowers/specs/2026-08-04-rbac-auth-service-runbook.md
git commit -m "$(cat <<'EOF'
docs(auth-service): add Google OAuth Client + RS256 keypair runbook

EOF
)"
```

---

### Task 13: Full suite green + manual E2E smoke

**Files:** none created/modified — verification only.

**Interfaces:**
- Consumes: everything from Tasks 1-12.
- Produces: nothing (terminal task).

- [ ] **Step 1: Full automated suite, both apps**

```bash
cd auth-service && npx vitest run --env-file=.env.local && npx tsc --noEmit && npm run lint
cd ../ads-agent && npx vitest run && npx tsc --noEmit && npm run lint
```

Expected: all green, zero new warnings in either app.

- [ ] **Step 2: Prerequisite check before the manual smoke**

Confirm a real Google OAuth Client (Task 12's runbook) has been created and its credentials are in
both `.env.local` files, and that `ADMIN_BOOTSTRAP_EMAILS` in `auth-service/.env.local` includes a
Gmail address you can actually sign into. If not, stop here and complete Task 12's runbook first — the
rest of this task cannot be simulated.

- [ ] **Step 3: Start both services + both databases locally**

```bash
cd auth-service && docker compose up -d db && npx tsx --env-file=.env.local lib/db/migrate.ts
npm run dev &   # http://localhost:3040

cd ../ads-agent && docker compose up -d db bifrost
export AUTH_SERVICE_URL=http://localhost:3040
export AUTH_SERVICE_INTERNAL_API_KEY=<same value as auth-service's INTERNAL_API_KEY>
npm run dev &   # http://localhost:3030
```

- [ ] **Step 4: Bootstrap-admin login walkthrough**

Visit `http://localhost:3030/` → expect a redirect to `http://localhost:3040/login`. Sign in with the
Gmail address listed in `ADMIN_BOOTSTRAP_EMAILS`. Expect a redirect back to `http://localhost:3030/`
showing the full dashboard (not the pending screen). Visit `/users` and confirm your own account
appears under **Members** with role `admin`.

- [ ] **Step 5: Non-bootstrap pending walkthrough**

In a different browser profile (or an incognito window, to get a separate cookie jar), sign in with a
*different* Gmail address. Expect the "Your account is pending approval" screen instead of the
dashboard. Confirm this second user now appears under **Pending approval** on the first (admin)
browser's `/users` page after a refresh.

- [ ] **Step 6: Role assignment walkthrough**

As the admin, use the pending user's row on `/users` to assign them `operator`. Have that user reload
any admin page (or sign out/in again) — confirm they now see `/campaigns` and `/proposals` normally,
but get the "You don't have access to this page" notice on `/credits`, `/settings`, and `/users`.

- [ ] **Step 7: Metered chat + credit-exhaustion walkthrough** (extends the existing credit-ledger
  smoke test now that a real session drives it)

As an operator or admin, open a campaign draft chat and send a message; confirm a reply comes back and
`/credits` shows the balance decreased with a new `usage_ledger` row attributed to the real logged-in
`userId` (not the old dev-seed UUID). Then zero the org's balance
(`UPDATE org_balances SET balance_credits = 0 WHERE org_id =
'00000000-0000-0000-0000-000000000001'`) and confirm the chat returns the "out of AI credits" message.
Restore the balance afterward via the Usage & Credits allocate form.

- [ ] **Step 8: Stop local services**

```bash
# kill the two `npm run dev` background jobs started in Step 3
```

- [ ] **Step 9: Parent session — store openmemory + update `openmemory.md`**

After this task, the **parent** (not a subagent) stores a project-fact memory covering: the new
`auth-service` app + its schema/module boundaries, the JWT/JWKS/refresh-cookie contract with
`ads-agent`, and the `(admin)/users` page location — and updates `openmemory.md` to mark the RBAC
design as implemented (mirroring how the token-credit-accounting entry was updated after its own
Task 7).

---

## Spec coverage checklist (self-review)

| Spec requirement | Task |
|---|---|
| `auth-service` own app + own Postgres, source of truth for identity/role | 1 |
| Google-only login (Auth.js), no passwords stored | 6 |
| Deny-by-default RBAC, pending state for new users | 1, 3, 6, 9 |
| `ADMIN_BOOTSTRAP_EMAILS` one-time bootstrap, all further changes via UI | 6, 11 |
| Fixed 3-tier roles (admin/operator/viewer), hierarchy enforcement | 1, 3, 9, 10 |
| `ads-agent` verifies JWT locally via JWKS, no per-request network call | 3, 7 |
| Middleware is UX-only, real enforcement in DAL | 3, 9, 10 |
| `ads-agent` shadow orgs/users JIT-provisioning | 3 |
| Auth flow: login → Google → JIT + bootstrap → mint JWT → set cookies → redirect | 6 |
| Silent refresh via rotating refresh token | 1, 7 |
| Internal API for role assignment, shared-secret guarded | 5, 8, 11 |
| Deployment: Caddyfile subdomains + docker-compose services | 4 |
| Google OAuth Client + RS256 keypair + `AUTH_SECRET` + `INTERNAL_API_KEY` setup | 12 |
| Security: httpOnly/Secure/SameSite cookies, 401 vs 403, redirect-safety, rate limiting | 3, 6, 9 |
| Non-goal guardrails (single org/user, fixed roles, no adapter, no key rotation automation) | Global Constraints (all tasks) |
| Full suite green + real Google OAuth manual smoke | 13 |

## Placeholder scan

No TBD/TODO steps. Two genuine open items are flagged explicitly rather than guessed at (matching the
prior plan's convention of calling out real unknowns instead of hiding them): Task 6 Step 13 notes that
Auth.js v5's exact installed callback/type signatures should be checked against
`node_modules/next-auth`'s own docs if `tsc` disagrees with this plan's code, since v5 has iterated its
API across betas; Task 13 explicitly requires a human to have completed Task 12's runbook (a real
Google Cloud OAuth Client) before its manual smoke steps are runnable — this cannot be simulated by an
agent.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-04-rbac-auth-service.md`.**

**Recommended execution:** Subagent-Driven with **parallel waves** + **Composer 2.5**
(`composer-2.5-fast` on every Task call), per the Parallel Execution Plan above.

1. **Subagent-Driven (recommended)** — parent dispatches Wave 0's 5 tasks in one message, reviews all
   five, then Wave 1's 5 tasks, then Wave 2's 2 tasks, then Wave 3's solo task.
2. **Inline Execution** — same waves, but implemented in this session without subagents.

**Which approach?**
