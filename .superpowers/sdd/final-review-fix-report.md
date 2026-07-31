## 2026-07-31 final review fixes

- Status: fixed the batch apply freshness race by hashing echoed submitted text, skipping stale rows during apply, and leaving existing cache data untouched when the listing changed mid-job.
- Docs: updated `openmemory.md` to remove the stale `GRAPH_SEED_ONLY` note and reflect the SQL-only rebuild path.
- Tests: `npm test -- lib/graph/batch-extract.test.ts lib/sync/content-hash.test.ts lib/graph/rebuild.test.ts lib/db/listings-entities.test.ts`
