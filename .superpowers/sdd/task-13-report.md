# Task 13 Report — Token metering and per-tenant cost ceiling

**Branch:** `feat/s9-t13-agent-cost`  
**Worktree:** `.worktrees/s9-t13`  
**Status:** ✅ Complete (C1 fixed)

## Summary

Implemented per-tenant daily cost ceilings with fail-closed enforcement. Token usage is recorded through a `SECURITY DEFINER` function (never direct INSERT), spend is read from a tenant-scoped view beside the usage table (not from Langfuse), and `assertWithinCeiling` halts when spend meets or exceeds the ceiling or when no ceiling row exists.

**C1 fix:** `v_agent_spend_today` uses `security_invoker = true`; migration 106 now grants `SELECT` on `context.agent_cost_ceilings` and `context.agent_token_usage` to `agent_ro` (Task 3 / migration 102 pattern). Both tables have FORCE RLS + tenant policy, so reads are safe when paired with `set_tenant`.

## Files

| Action | Path |
|--------|------|
| Create | `ads-agent/lib/db/migrations/106_agent_token_usage.up.sql` |
| Create | `ads-agent/lib/db/migrations/106_agent_token_usage.down.sql` |
| Create | `ads-agent/lib/db/agent-cost.ts` |
| Create | `ads-agent/lib/db/agent-cost.test.ts` |
| Create | `ads-agent/lib/db/agent-cost.gate.test.ts` |
| Modify | `ads-agent/mcp/context-server/read-views.test.ts` (allowlist + view list) |

## Deviations from brief

1. **Migration number** — Per `.superpowers/sdd/OVERRIDES.md`, migration is `106_agent_token_usage` (105 is `create_proposal`).
2. **Task 17 wiring** — No changes to tool-context/dispatch; ceiling and metering are library-only as specified.
3. **Base-table grants** — Brief SQL omitted them; added per Task 3 precedent (review C1).

## Test results

```
cd ads-agent && npx vitest run lib/db/agent-cost.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)

DATABASE_URL=... AGENT_RO_DATABASE_URL=... npx vitest run lib/db/agent-cost.gate.test.ts
Test Files  1 passed (1)
Tests       2 passed (2)
```

## Migration result

Applied `106_agent_token_usage.up.sql` against `postgres://gentle:gentle@localhost:5433/gentle_space_listings` via `docker exec gentle-space-pg psql` (host `psql` not on PATH).

```
CREATE TABLE context.agent_token_usage
CREATE TABLE context.agent_cost_ceilings  (273 org rows seeded at $5/day)
CREATE VIEW  context.v_agent_spend_today
CREATE FUNCTION context.record_agent_token_usage
```

Recorded in `public.schema_migrations`: `105_agent_create_proposal`, `106_agent_token_usage`.

Note: full `migrate.ts` run failed at `040_outbox_events` because the DB predates the ledger; 106 was applied directly.

## Live grant proof (C1)

Before fix:

```
has_table_privilege('agent_ro', 'context.agent_cost_ceilings', 'SELECT') → f
has_table_privilege('agent_ro', 'context.agent_token_usage', 'SELECT')   → f
```

Applied on live DB:

```sql
GRANT SELECT ON context.agent_cost_ceilings, context.agent_token_usage TO agent_ro;
```

After fix:

```
has_table_privilege('agent_ro', 'context.agent_cost_ceilings', 'SELECT') → t
has_table_privilege('agent_ro', 'context.agent_token_usage', 'SELECT')   → t
```

As `agent_ro` after `set_tenant`:

```sql
SELECT spent_usd, ceiling_usd FROM context.v_agent_spend_today;
--  spent_usd | ceiling_usd
-- -----------+-------------
--  0.001000  |    5.000000
```

## Commits

- `1f6bb30` — feat(agent-cost): per-tenant daily ceiling that halts, from the token metrics
- *(this commit)* — fix(agent-cost): grant agent_ro SELECT on cost RLS bases for invoker view
