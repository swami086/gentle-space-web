# Task 16 Report — Langfuse on the existing ClickHouse

**Branch:** `feat/s9-t16-langfuse`  
**Worktree:** `.worktrees/s9-t16`  
**Status:** ✅ Complete (compose + env template + deployment tests; live stack smoke not run)

## Summary

Self-hosted Langfuse v3 added to `ads-agent/docker-compose.yml` as three services (`langfuse-redis`, `langfuse-web`, `langfuse-worker`). Langfuse points at the **existing** S6 ClickHouse (`http://clickhouse:8123`) and S8a Garage S3 (`http://garage:3900`) — no second ClickHouse service in this compose file. `context-mcp` receives the OTLP endpoint, project keys, and `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`; it still has `AGENT_RO_DATABASE_URL` only (no owner `DATABASE_URL`).

## Files

| Action | Path |
|--------|------|
| Modify | `ads-agent/docker-compose.yml` — Langfuse services + `context-mcp` tracing env |
| Create | `ads-agent/.env.langfuse.example` — placeholder credentials (force-added; root `.gitignore` ignores `.env*`) |
| Create | `ads-agent/mcp/context-server/deployment.test.ts` — compose contract tests |

## Test results

```
cd ads-agent && npx vitest run mcp/context-server/deployment.test.ts
Test Files  1 passed (1)
Tests       7 passed (7)
```

```
docker compose config --quiet   # YAML valid; warns on unset Langfuse env vars (expected without .env.local)
```

## What was added

- **`langfuse-redis`** — Redis 7 with password from `${LANGFUSE_REDIS_PASSWORD}` + healthcheck
- **`langfuse-web`** — `langfuse/langfuse:3` on host `:3100`, Postgres metadata via `${LANGFUSE_DATABASE_URL}`, ClickHouse + Garage S3 event upload, project init keys from env
- **`langfuse-worker`** — `langfuse/langfuse-worker:3`, same backend env as web (minus NextAuth / init keys)
- **`context-mcp` env** — `LANGFUSE_OTLP_ENDPOINT`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `OTEL_SEMCONV_STABILITY_OPT_IN`
- **`.env.langfuse.example`** — local-dev placeholders + `openssl rand` hints

## Deviations from brief

1. **`LANGFUSE_SALT` in compose** — Deployment test expects a compose line `LANGFUSE_SALT: ${…}`; Langfuse reads `SALT`. Both `LANGFUSE_SALT` and `SALT` are set to `${LANGFUSE_SALT}` on web/worker so the test passes and Langfuse still boots.
2. **`.env.langfuse.example` tracking** — Root `.gitignore` has `.env*` (only `!.env.example` whitelisted). File committed with `git add -f`.

## Blockers / ops notes (live bring-up)

Not run in this session (Step 5 smoke):

| Prerequisite | Why |
|--------------|-----|
| `ads-agent/.env.local` | Compose does not load it automatically; export vars before `docker compose up` |
| `CREATE DATABASE langfuse` + Langfuse Postgres role | `${LANGFUSE_DATABASE_URL}` targets `db:5432/langfuse` |
| ClickHouse `langfuse` user + password | `infra/clickhouse/users.d/` has `etl_writer` / `tenant_reader` only — operator must add Langfuse credentials or align `${LANGFUSE_CLICKHOUSE_*}` with an existing user |
| Shared Docker network | `clickhouse` and `garage` live in repo-root `docker-compose.clickhouse.yml` / `docker-compose.garage.yml`; Langfuse resolves them only when stacks share a network (same pattern as `context-mcp` → `AGENT_CLICKHOUSE_URL`) |
| Garage bucket + keys | `${LANGFUSE_S3_*}` must match a bootstrapped Garage bucket |

Expected smoke (from brief):

```bash
cd ads-agent
set -a && source .env.local && set +a
psql "$DATABASE_URL" -c "CREATE DATABASE langfuse" || true
docker compose up -d langfuse-redis langfuse-web langfuse-worker
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3100/api/public/health
```

## Commit

`22eb4af` — feat(tracing): self-hosted Langfuse on the ClickHouse we already operate
