# Migration ledger reconcile

**Date:** 2026-08-13  
**Target:** consolidated DB from ads-agent `.env.local` `DATABASE_URL` (`localhost:5433` / `gentle_space_listings`)  
**Method:** senior-backend ledger repair — apply pending `.up.sql` in order; on “already exists” stamp `schema_migrations` only; vacuous stamp for 058/059 when `search_queries` never existed.

## Result

- **Disk `.up.sql`:** 63 (Torbit `gl_file` count matches)
- **Ledger rows:** 63 (`001_role_vocabulary` … `110_proposal_cross_tenant_claim`)
- **`npm run migrate`:** `ads-agent: schema applied, no pending migrations`
- **Still pending:** none

## Pass summary

| Action | Versions |
|--------|----------|
| **Stamped (already present)** | 040–044 (outbox / consumed_events), 101 (`agent_task_tokens_sha_unique` already existed) |
| **Stamped (vacuous)** | 058 (COMMENT on missing `search_queries`), 059 (retire no-op — table never existed) |
| **Applied for real** | 050–057, 060–061, 070–074, 080–082, 085–087, 100, 102–103 |
| **Already on ledger before reconcile** | 001–030, 104–110 (incl. S11 107–110) |

## Notes

- Do **not** re-run 107–110; they were applied earlier and remain on the ledger.
- 058/059 stamped only because this DB never had `public.search_queries`; safe with `ALTER TABLE IF EXISTS` semantics of 059.
- 101 stamped after unique-constraint collision; `context.agent_task_tokens` is present.
