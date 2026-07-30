# Incremental listings sync design

Date: 2026-07-30
Status: approved (design), not yet implemented

## Context

`runListingsSync()` currently wipes the catalog on every run. `fullReplaceListings()`
issues an unconditional `DELETE FROM listings` (`lib/db/listings.ts:81`) and reinserts
whatever the four Firecrawl adapters returned, with a freshly generated `id` per row
(`lib/sync/run-sync.ts:54`). Three consequences:

- Every run re-scrapes every detail page of every source, so Firecrawl cost scales with
  catalog size rather than with change.
- `embedAllListings()` re-embeds the entire catalog afterwards, and
  `rebuildListingGraph()` makes one Gemini `extractSearchEntities` call per listing
  (`lib/graph/rebuild.ts:39`) after wiping the graph. Both redo 100% of the work even
  when nothing changed.
- A partial scrape still counts as success, so the site can silently lose whole sources.

## Goals

1. A scrape run updates existing listings and inserts new ones instead of replacing the table.
2. Cut Firecrawl consumption so cost tracks change, not catalog size.
3. Cut Vertex embedding and Gemini entity-extraction consumption the same way.
4. Stop a flaky source from removing listings that are still live.

## Non-goals

- Fixing myHQ locality-hop discovery, CoFynd `CITY_SLUGS`, or the missing coordinates on
  CoFynd/GoFloaters detail pages. Those are tracked separately in `openmemory.md`.
- Resuming the paused Render cron.
- Migrating the Firecrawl client from v1 to v2.

## Policy decisions

| Decision | Choice |
|---|---|
| Listing disappears from source | Soft-delete with a grace period; the row is never deleted |
| Grace period | Hidden after 3 *successful* runs of that source without a sighting; failed runs do not count |
| Freshness of existing listings | TTL-based refresh, 7-day default, env-configurable |
| Commit granularity | Per source, independently |

One TTL per listing, not per field. `pricing_hint`, `description`, and `amenities` all
come from the same single detail-page fetch, so price cannot be refreshed without
refreshing everything. If price freshness matters more, lower the single TTL.

Configuration: `LISTING_DETAIL_TTL_DAYS` (default `7`) and `LISTING_MISSING_RUNS_LIMIT`
(default `3`).

## Architecture

```
runListingsSync({ adapters?, maxDetailScrapes?, trackMissing?, skipDownstream? })
  for each source, independently:
    1. discover()                     -> DiscoveredListing[] { sourceId, url }
    2. listExistingForSource(source)  -> metadata only, no descriptions or vectors
    3. planSourceScrapes()            -> { toScrape, toTouch }
         new sourceId          -> scrape
         known, synced_at older than TTL -> scrape
         known, within TTL     -> touch only (no Firecrawl call)
    4. fetchDetail() for toScrape, bounded concurrency
    5. upsertListings()               -> { inserted, updated, unchanged }
    6. markListingsSeen(discovered)   -> last_seen_at = NOW(), missing_runs = 0
    7. incrementMissingRuns(not discovered)
    8. record per-source outcome
  then, once:
    embedListingsMissingEmbedding()   -> only rows whose embedding was cleared
    syncListingGraph(changed)         -> only embedding-relevant changes; no full wipe
```

Boundaries:

- Adapters never touch Postgres and never decide freshness.
- The orchestrator never knows source-specific URL shapes.
- Soft-hide is driven by **discovery presence**, never by whether a detail scrape ran.
  A TTL-skipped listing is still "seen".
- A "touch" updates `last_seen_at` and resets `missing_runs`, and must **never** write
  `synced_at`. Touching `synced_at` without an actual scrape would keep pushing the TTL
  deadline forward, so a listing would never refresh again.
- A failed source writes nothing and does not advance `missing_runs`.

## Data model

New migration `lib/db/migrations/005_incremental_sync.sql`, following the existing
`002`/`003`/`004` convention.

On `listings`:

| Column | Type | Purpose |
|---|---|---|
| `last_seen_at` | `TIMESTAMPTZ NOT NULL` | Last successful run whose discovery saw this listing |
| `missing_runs` | `INT NOT NULL DEFAULT 0` | Consecutive successful runs of that source without a sighting |
| `content_hash` | `TEXT` | Hash of all persisted display fields; decides whether an UPDATE is needed |
| `embed_hash` | `TEXT` | Hash of `buildListingEmbeddingText()` output only |

`synced_at` is repurposed to mean "when this listing's detail page was last scraped",
which is the TTL basis. This is safe because no component reads `listing.syncedAt`;
`/spaces` staleness comes from `sync_runs.finishedAt` via `isStaleSync()`
(`app/spaces/page.tsx:28`).

Two hashes, not one, because `buildListingEmbeddingText` reads only title, area, city,
propertyType, pricingHint, shortTeaser, description, and amenities
(`lib/listings/embedding-text.ts:1-10`). Images, address, coordinates, and source URL are
excluded. These sites rotate image URLs frequently, and a single hash would re-embed the
catalog on churn that cannot affect search results.

On `sync_runs`: add `sources JSONB` holding per-source outcome — status, discovered,
scraped, inserted, updated, unchanged, hidden, error. JSONB rather than a
`sync_run_sources` table because it is only read for ops and debugging.

Visibility is **derived** (`missing_runs < threshold`), not a stored flag, so the
threshold stays configurable without a migration.

Backfill for the 10 existing rows: `last_seen_at = synced_at`, `missing_runs = 0`, both
hashes `NULL`. A `NULL` hash reads as "unknown", so the first incremental run recomputes
and re-embeds those 10 rows once.

## Interfaces

`lib/sync/sources/types.ts`:

```typescript
export type DiscoveredListing = {
  sourceId: string;
  url: string;
};

export type SourceAdapter = {
  source: ListingSource;
  discover(): Promise<DiscoveredListing[]>;
  fetchDetail(url: string): Promise<RawListing | null>;
};
```

Discovery returns `sourceId` because every adapter already derives it while canonicalizing
URLs (`slugFromUrl` in myHQ and CoFynd, `sourceIdFromGoFloatersUrl`). This keeps the
orchestrator's join on the same key as the database's `UNIQUE (source, source_id)`
(`lib/db/schema.sql:23`) instead of matching URL strings.

New modules:

| Module | Responsibility |
|---|---|
| `lib/sync/plan.ts` | Pure: discovered + existing metadata + now + TTL -> `{ toScrape, toTouch }` |
| `lib/sync/content-hash.ts` | `contentHash(raw)` and `embedHash(raw)`, SHA-256 over stable field ordering |
| `lib/sync/concurrency.ts` | `mapWithConcurrency`, used by the orchestrator and by GoFloaters discovery, which currently fans out unbounded (`lib/sync/sources/gofloaters.ts:191-194`) |

`lib/db/listings.ts`:

- `listExistingForSource(source)` — projects only `source_id, id, slug, synced_at,
  content_hash, embed_hash`. Never `SELECT *`: planning must not load descriptions and
  768-dimension vectors for the whole catalog.
- `upsertListings(rows)` -> `{ inserted, updated, unchanged }` via
  `ON CONFLICT (source, source_id) DO UPDATE`.
- `markListingsSeen(source, sourceIds)`.
- `incrementMissingRuns(source, seenSourceIds)`.
- `fullReplaceListings` is deleted. Its other caller,
  `scripts/preview-listings-sync.ts:83`, moves to the same upsert path, so `sync:preview`
  stops being destructive.

Three rules inside the upsert:

1. `id` and `slug` are never updated. `id` stops churning, and holding the original slug
   keeps `/spaces/[slug]` URLs alive. Cost: after a source renames a space, the slug keeps
   the old wording. Stable URLs win.
2. `embedding` is set to `NULL` only when `embed_hash` changes. This is what makes
   embedding incremental — `embedListingsMissingEmbedding()` is then just
   `WHERE embedding IS NULL`.
3. Visibility filters are added to all three read paths — `listListings`,
  `getListingBySlug`, and `searchListingsByEmbedding`. Hiding from browse while still
  serving the detail page would leave live URLs for delisted spaces; hiding everywhere
  also matches today's behavior, since full-replace deleted the row and the page 404'd.
  Because incremental storage retains every source's row, browse and vector-search results
  also apply the existing `dedupeListings()` source-priority rule at read time. Vector
  search fetches up to `k * 4` candidates (four sources), dedupes, then slices to `k`.
  This preserves lower-priority rows as fallbacks without showing duplicate spaces.

Graph (`lib/graph/`): add `syncListingGraph(changed)` — one
`extractSearchEntities` call only when embedding-relevant content changed (or a listing
reactivated). `replaceListingGraph()` atomically deletes and recreates that listing node
so removed amenities/areas do not leave stale edges. Soft-hidden listing nodes remain in
AGE: vector search filters hidden database rows before graph scoring, so they are never
candidates, and retaining the node makes discovery-only reactivation safe even if its
detail scrape fails. `npm run graph:rebuild` remains the cleanup/recovery path and removes
hidden nodes during its full wipe.

Firecrawl client: `firecrawlScrape(url, { includeLinks })`. Detail scrapes drop the
`links` format they never use — only discovery needs it — shrinking every detail response
(`lib/firecrawl/client.ts:30-34`).

Orchestrator options `adapters` and `maxDetailScrapes` give the pipeline single-source and
capped-run controls it currently lacks. `trackMissing: false` and
`skipDownstream: true` are explicit operational-check safeguards, not production defaults.

## Where the savings come from

| Cost | Today | After |
|---|---|---|
| Firecrawl detail scrapes | Every listing, every run | Only new listings and listings past TTL |
| Firecrawl response size | `markdown` + `links` on every detail page | `markdown` only |
| Firecrawl discovery fan-out | Unbounded `Promise.all` on GoFloaters localities | Bounded concurrency |
| Vertex embeddings | Whole catalog, every run | Only rows whose embedding text changed |
| Gemini entity extraction | Whole catalog, every run, after a graph wipe | Only embedding-relevant changes/reactivations |

On a stable catalog, a run performs discovery calls plus zero detail scrapes, zero
embeddings, and zero Gemini calls.

## Failure handling

| Failure | Behavior |
|---|---|
| `discover()` throws | Source recorded `failed`; no writes; `missing_runs` untouched; other sources continue |
| One detail scrape throws | That URL is skipped; the rest of the source still commits |
| Source discovers 0 URLs | Treated as a soft failure, so a blank index page cannot soft-hide a whole source |
| Upsert transaction fails | That source rolls back; already-committed sources stand; run is `failed` only if every source failed |
| Embed fails | Soft-fail; recoverable with `npm run embed:backfill` |
| Graph sync fails | Soft-fail; recoverable with `npm run graph:rebuild` |

The global abort `sourcesOk < 1 || raw.length < 10` (`lib/sync/run-sync.ts:38`) is removed.
The 10-listing floor existed to stop full-replace from wiping the catalog to near-empty;
upsert has nothing to wipe.

## Testing

Unit tests (vitest, no live network):

| Area | Assertions |
|---|---|
| `plan.ts` | New URL scrapes; fresh known touches only; stale known scrapes; empty discovery yields empty plan |
| `content-hash.ts` | Identical fields hash identically; a price change flips both hashes; an image-only change flips `contentHash` but not `embedHash` |
| Adapters | Existing parse fixtures retained; `fetchAll` tests rewritten against `discover` + `fetchDetail` |
| `run-sync.test.ts` | One source fails and the other still upserts; a failed source does not bump `missing_runs`; a TTL skip never calls `fetchDetail` |
| Read paths | Rows at or past the threshold are excluded from `listListings`, `getListingBySlug`, and `searchListingsByEmbedding` |
| Upsert | Re-syncing identical content reports `unchanged` and leaves `embedding` intact |

Live Firecrawl check — `scripts/check-incremental-sync.ts`, exposed as `npm run
sync:check`. It discovers CoFynd once, wraps the adapter to expose one selected listing,
disables missing-run advancement and AI downstream work, then runs that constrained
adapter twice:

- Run 1: one real Firecrawl detail scrape; the listing is inserted or updated.
- Run 2, immediately after: TTL has not expired, so `sources[x].scraped === 0`, the
  stable row is touched and `last_seen_at` advances without changing `synced_at`.

CoFynd is the source to use: its discovery is one `/map` plus one index scrape (~18 detail
URLs found), versus Coworker walking up to 50 list pages. Total live cost for the full
two-pass check is one discovery plus one detail scrape; the second pass uses the
already-constrained discovery result. This check is manual/ops, not CI. Unit tests, not
the live check, prove unchanged embeddings are preserved.

## Rollout

1. Apply `005_incremental_sync.sql` to the local database (the pre-existing
   `backup-listings-20260730-084824.sql` dump is the rollback path).
2. Implement bottom-up, TDD per unit: `content-hash` -> `plan` -> db functions ->
   adapters -> orchestrator -> embed -> graph.
3. Run the unit suite, then `npm run sync:check` against CoFynd.
4. Verify `/spaces` still renders and `POST /api/spaces/search` still boosts
   (`npm run graph:check`).

## Risks and known simplifications

- Repurposing `synced_at` changes the meaning of an existing column. Verified unused by
  the UI, but any future consumer must read it as "detail last scraped".
- Deleting a listing from the graph orphans `Area`/`Amenity` vertices. Harmless; upgrade
  path is a periodic orphan sweep if the graph ever grows large.
- Slugs drift from titles after a source rename. Accepted in exchange for stable URLs.
- The TTL means a price change on an existing listing can take up to 7 days to appear.
  Lower `LISTING_DETAIL_TTL_DAYS` to trade Firecrawl cost for freshness.
- Two adapters (myHQ, CoFynd) and both coordinate gaps remain broken independently of this
  work; a 4-source sync is still not advisable until those are fixed.
