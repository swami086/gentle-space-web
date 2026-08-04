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

## Tests

```bash
npx vitest run --env-file=.env.local
```

(`--env-file=.env.local` is required for `lib/jwt.test.ts`, which signs/verifies real tokens against
the RS256 keypair in `.env.local`.)
