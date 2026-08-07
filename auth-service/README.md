# auth-service

Google SSO + RBAC identity provider for the Gentle Space admin portal. See
[the design spec](../docs/superpowers/specs/2026-08-04-rbac-auth-service-design.md) for the full
architecture.

## Local development

```bash
docker compose up -d db
cp .env.example .env.local   # fill in every var — see docs/superpowers/specs/2026-08-04-rbac-auth-service-runbook.md
npm install
npx tsx --env-file=.env.local lib/db/migrate.ts
npm run dev   # http://localhost:3040
```

`npm run dev` unsets `DATABASE_URL` / `GOOGLE_CLIENT_*` / `ADMIN_BOOTSTRAP_EMAILS` from the parent
shell before starting Next so `.env.local` wins. Without that, an inherited ads-agent
`DATABASE_URL` (port 5434) makes `/bridge` crash with `column "google_sub" of relation "users"
does not exist` — that column only exists on the auth DB (port 5435).

## Tests

```bash
node --env-file=.env.local ./node_modules/.bin/vitest run
```

(Vitest 4 lacks `--env-file`; use Node's flag. Required for `lib/jwt.test.ts`, which signs/verifies
real tokens against the RS256 keypair in `.env.local`.)
