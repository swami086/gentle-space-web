## 2026-07-31 final review fixes

- Preserved a non-empty Bengaluru/Bangalore postal `address` across Pass 2 locality-only accepts in `lib/sync/enrich-listings.ts`, while still allowing Pass 2 to improve `area` or fill `pricingHint` independently.
- Tightened cooldown semantics to a hard recent-accept skip in `lib/sync/enrich-listings.ts` / `lib/db/listings.ts`; removed the stale `syncedAt` comparison and switched the SQL interval parameter to `($1 * interval '1 day')`.
- Hardened `gateLocation()` in `lib/sync/enrich-gate.ts` to reject obvious non-Bangalore city signals (for example `Gurugram`) in both `locality` and `address`.
- Returned `acceptedIds` from `enrichListings()` and taught `runListingsSync()` to reload those rows via `getListingsByIds()` before `syncListingGraph()`, so enrichment-only updates now refresh AGE in the same run.
- Added/updated focused regression coverage in `lib/sync/enrich-listings.test.ts`, `lib/sync/enrich-gate.test.ts`, `lib/sync/run-sync.test.ts`, and `lib/db/listings-enrichment.test.ts`.
- Cleaned an obvious duplicated local DB/setup block from `README.md`.

### Verification

```bash
npx vitest run lib/sync/enrich-gate.test.ts lib/sync/enrich-listings.test.ts lib/sync/run-sync.test.ts lib/db/listings-enrichment.test.ts
```

Passed: 4 files, 34 tests.
