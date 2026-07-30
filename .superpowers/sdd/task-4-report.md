# Task 4 Report

## Summary

Implemented Task 4 by splitting source adapters into `discover()` and `fetchDetail(url)`, slimming Firecrawl detail scrapes to markdown-only by default, and adding the smallest `run-sync` bridge that still full-replaces listings. Parser behavior and known discovery gaps were left unchanged.

## RED Evidence

### Command

```bash
npm test -- lib/firecrawl/client.test.ts
```

### Result

- Failed as expected before the client change.
- `firecrawlScrape("https://example.com/detail")` still sent `formats: ["markdown", "links"]`.
- This proved detail scrapes were still over-requesting `links`.

## GREEN Evidence

### Focused tests

```bash
npm test -- lib/firecrawl/client.test.ts lib/sync/sources/coworker.test.ts lib/sync/sources/myhq.test.ts lib/sync/sources/cofynd.test.ts lib/sync/sources/gofloaters.test.ts lib/sync/run-sync.test.ts
```

- Passed: `6` files, `43` tests.

### Full suite

```bash
npm test
```

- Passed: `30` files, `120` tests.

### Typecheck

```bash
npx tsc --noEmit
```

- Passed.
- One type-only issue surfaced during verification in `lib/sync/sources/gofloaters.ts`; it was fixed by making the pricing fallback end in `null` instead of `undefined` without changing parser behavior.

## Commands And Results

1. `npm test -- lib/firecrawl/client.test.ts`
   - RED first, then GREEN after `firecrawlScrape()` accepted `includeLinks`.
2. `npm test -- lib/firecrawl/client.test.ts lib/sync/sources/coworker.test.ts lib/sync/sources/myhq.test.ts lib/sync/sources/cofynd.test.ts lib/sync/sources/gofloaters.test.ts lib/sync/run-sync.test.ts`
   - GREEN, `43/43` tests passed.
3. `npm test`
   - GREEN, `120/120` tests passed.
4. `npx tsc --noEmit`
   - Failed once on `string | undefined` in GoFloaters pricing fallback, then GREEN after the type fix.

## Files Changed

- `lib/firecrawl/client.ts`
- `lib/firecrawl/client.test.ts`
- `lib/sync/plan.ts`
- `lib/sync/run-sync.ts`
- `lib/sync/run-sync.test.ts`
- `lib/sync/sources/types.ts`
- `lib/sync/sources/index.ts`
- `lib/sync/sources/coworker.ts`
- `lib/sync/sources/coworker.test.ts`
- `lib/sync/sources/myhq.ts`
- `lib/sync/sources/myhq.test.ts`
- `lib/sync/sources/cofynd.ts`
- `lib/sync/sources/cofynd.test.ts`
- `lib/sync/sources/gofloaters.ts`
- `lib/sync/sources/gofloaters.test.ts`
- `.superpowers/sdd/task-4-report.md`

## Self-Review

- Kept the Task 4 scope narrow: no incremental planning, no `applySourceSync`, no parser rewrites.
- Moved `DiscoveredListing` ownership into `lib/sync/sources/types.ts` and updated `lib/sync/plan.ts` to import it.
- Ensured discovery scrapes explicitly request links while detail scrapes do not.
- Kept the orchestrator behavior intentionally transitional: it now discovers then fetches details, but still aggregates into `fullReplaceListings()`.
- Updated source adapter tests to prove the new seam directly: discovery does not scrape details, and detail fetches parse one page without requesting links.

## Concerns

- Known live-source gaps remain intentionally untouched: myHQ locality hopping, CoFynd discovery leakage/coord gaps, and GoFloaters coord gaps.
- `runListingsSync()` now has a temporary bridge over the new adapter contract; Task 5 still needs to replace that full-replace path with incremental apply logic.

## Review Follow-Up

### Regression fixed

- `scripts/preview-listings-sync.ts` was still scraping `COWORKER_LIST_BASE` without `{ includeLinks: true }` while reading `list.links`.
- Fixed by changing that discovery scrape to `firecrawlScrape(COWORKER_LIST_BASE, { includeLinks: true })`.

### Grep result

- Searched for `firecrawlScrape` callers that read `.links`.
- Only one unmigrated production caller remained: `scripts/preview-listings-sync.ts`.
- Existing adapter discovery callers were already migrated:
  - `lib/sync/sources/coworker.ts`
  - `lib/sync/sources/myhq.ts`
  - `lib/sync/sources/cofynd.ts`
  - `lib/sync/sources/gofloaters.ts`

### Follow-up verification

1. `npm test -- lib/firecrawl/client.test.ts`
   - GREEN, `6/6` tests passed.
2. `npm test`
   - GREEN, `120/120` tests passed.

### Follow-up files changed

- `scripts/preview-listings-sync.ts`
- `.superpowers/sdd/task-4-report.md`
