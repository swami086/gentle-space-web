# OpenMemory Guide — GentleSpace_Web

## Overview

Standalone Next.js marketing + coworking listings site for **Gentle Space** (Bangalore CRE). Public repo: https://github.com/swami086/gentle-space-web. Extracted from Resume worktree `.worktrees/gentle-space-nextjs/gentle-space-web`. Primary public site: Netlify (`gentle-space-live`); sync/listings infra on Render (`gentle-space-web` + cron).

## User Defined Namespaces

- [Leave blank - user populates]

## Architecture

- **Marketing home** (`/`): static sections (Hero, Services, HowItWorks, FAQ, Founder, CTA).
- **Spaces product** (`/spaces`): Airbnb-style browse with AI search, client filters, split map, detail pages (`/spaces/[slug]`).
- **AI search**: `POST /api/spaces/search` — vector-first pgvector rank-boost; optional Apache AGE GraphRAG scoring when configured.
- **Ingest**: Firecrawl listings sync from 4 sources (Coworker, myHQ, CoFynd, GoFloaters) now runs per-source incremental discovery/plan/apply orchestration, then soft-fails downstream embedding + graph hooks. Embeddings now backfill only `embedding IS NULL` rows; AGE sync now replaces graph state only for changed/reactivated rows while preserving the full rebuild recovery path. `sync:preview` now reuses the same incremental write path for capped Coworker runs, and `sync:check` provides a one-listing live CoFynd probe.
- **AI provider**: Vertex preferred (`AI_PROVIDER=vertex`, project `propane-galaxy-498403-n8`, `text-embedding-004` / `gemini-2.5-flash-lite`); OpenAI fallback.

## Components

| Area | Key paths |
|------|-----------|
| Browse UI | `components/spaces/SpacesBrowseClient.tsx`, `SpacesHomeHero`, `SpacesBrowseChrome`, `SpacesAiSearch`, `SpacesFiltersModal`, `SpacesMap`, `SpaceGallery` |
| Search API | `app/api/spaces/search/route.ts` |
| Listings DB | `lib/db/*`, `docker-compose.listings.yml` (port **5433**) |
| Sync | `lib/sync/run-sync.ts`, `lib/sync/sources/*`, `scripts/run-listings-sync.ts` |
| Sync planning | `lib/sync/plan.ts`, `lib/sync/content-hash.ts`, `lib/sync/config.ts` |
| Listings migrations | `lib/db/migrations/005_incremental_sync.sql` |
| Embeddings | `lib/sync/embed-listings.ts`, `scripts/backfill-embeddings.ts` |
| GraphRAG | `lib/graph/*`, migration `004_age.sql`, `npm run graph:rebuild` |
| AI facade | `lib/ai/client.ts` → `lib/vertex/*` or `lib/openai/*` |

## Patterns

- Spaces filters stay pure in `lib/listings/filterListings.ts`.
- `SpacesBrowseClient` owns idle hero ↔ browse chrome mode; failed AI search snaps back to `initialListings`.
- Sync soft-fails embed + graph rebuild after successful listing write.
- Sync hashes are split into content vs embed scope in `lib/sync/content-hash.ts`; both normalize amenity ordering with `buildListingEmbeddingText()` still as the embedding-text source of truth.
- `runListingsSync()` now processes each adapter independently: `discover()` → `listExistingForSource()` → `planSourceSync()` → bounded detail scrapes → one `applySourceSync()` call, with source-local failures captured in `sync_runs.sources` and no shared full-replace abort threshold.
- `scripts/preview-listings-sync.ts` is now a thin Coworker-only wrapper around `runListingsSync({ adapters: [coworkerAdapter], maxDetailScrapes, trackMissing: false, skipDownstream: true })`, so preview runs are capped, non-destructive, and do not spend downstream embedding/graph tokens.
- `scripts/check-incremental-sync.ts` performs a live CoFynd operational check by constraining discovery to one usable listing, forcing one first-run detail scrape with `ttlMs: 1`, then proving the immediate second run scrapes zero details with `trackMissing: false` and `skipDownstream: true`.
- Source adapters now split discovery from detail scraping: `discover()` returns canonical `{ sourceId, url }` items, `fetchDetail(url)` parses one detail page, and Firecrawl only requests `links` during discovery scrapes.
- Discovery callers that read Firecrawl `links` must now opt in with `{ includeLinks: true }`; markdown-only is the default for detail scrapes and any other callers not consuming links.
- Incremental DB primitives in `lib/db/listings.ts` now back the live orchestrator: per-source upsert/touch/hide keeps `id`/`slug` stable, uses a 7-day detail TTL by default (`LISTING_DETAIL_TTL_DAYS`), preserves embeddings unless `embed_hash` changes, soft-hides rows after 3 successful unseen runs by default (`LISTING_MISSING_RUNS_LIMIT`), and dedupes cross-source variants at vector-search read time.
- `embedListingsMissingEmbedding()` now reuses the chunked embed loop over `listListingsMissingEmbedding()` only; `scripts/backfill-embeddings.ts` now truly fills missing vectors instead of re-embedding every listing.
- `syncListingGraph(changed)` now prepares extraction for every changed/reactivated listing before the first AGE write, then calls `replaceListingGraph()` per listing. Soft-hidden `Listing` nodes intentionally remain in AGE until `graph:rebuild`; vector search filters hidden SQL rows before graph scoring, and `rebuildListingGraph()` still does wipe-once + `upsertListingGraph()` recovery.
- Map pins use approximate coords (`lib/listings/approximateCoords.ts`) for privacy.

## Local runtime setup (verified 2026-07-30)

Runtime config is **not in git** — it was copied from `~/Documents/Resume/gentle-space-web/`:

- `.env.local` — `DATABASE_URL`, `AI_PROVIDER=vertex`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`, `VERTEX_*` models, `FIRECRAWL_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY`, `GOOGLE_MAPS_EMBED_KEY`, `GOOGLE_GEOCODING_API_KEY`. `GOOGLE_APPLICATION_CREDENTIALS` must be rewritten to this workspace's absolute path.
- `.secrets/gentle-space-vertex-stackgen.json` (+ `gentle-space-vertex.json`) — Vertex SA keys, mode `600`. Both are gitignored (`.env*`, `.secrets/`) — keep it that way, the remote is public.

**Docker:** the pgvector+AGE volume was created by the Resume folder, so compose must pin the original project name or a new empty volume is used instead:

```bash
docker compose -p gentle-space-web -f docker-compose.listings.yml up -d
```

Persisted volume `gentle-space-web_gentle_space_pgdata` already contains the applied schema (AGE 1.6.0, vector 0.8.1, `embedding vector(768)`) and 10 embedded Coworker listings from the 2026-07-23 sync — so schema/migrations and `sync:preview`/`embed:backfill` do **not** need re-running for local preview.

## Known issues / ops state

- **AGE graph boost fixed (2026-07-30).** Root cause was `label(e)[0]` in `scoreListingsAgainstQuery()` — Apache AGE's `label()` returns a scalar string, so indexing it threw Postgres `22023` / `agtype_access_operator`. The unused `elabel` projection was dropped; scoring buckets by `type(r)` only. Verified by a direct Bellandur AGE probe (`overlap: 3` for `cowrks-ecoworld-cowrks-ecowo`) and live `POST /api/spaces/search` with no fresh graph-fallback log on the active dev server.
- `npm run graph:check` can still fail after `sync:check` inserts the live CoFynd probe row: the script grabs the first listing with any `area`, and that CoFynd detail currently stores malformed markdown-alt text in `area`, which produced `overlap: 0` for `corporatedge-ub-city-corporatedge` during Task 8 verification even though Bellandur rows still score.
- Render cron `gentle-space-listings-sync` (`crn-d9h1qfsm0tmc738a6u0g`) still **paused since 2026-07-26** (intentionally left paused).
- **Do not resume the 4-source live sync yet.** The risk is source-quality gaps under the incremental pipeline, not a missing full-replace path. Live Firecrawl probes (2026-07-30) found adapter discovery/coord gaps:
  - **myHQ:** `/map` alone returns locality indexes, not details. Detail URLs (`/dedicated/coworking-space/{slug}`) appear only after hopping a locality page. Adapter needs a GoFloaters-style locality hop. Once on a detail page, coords parse correctly (strict pair in Bengaluru).
  - **CoFynd:** discovers real detail slugs from the Bangalore index, but `gurugram` leaks through `CITY_SLUGS` (alias of `gurgaon`). Live detail markdown has **no lat/lng**; area parsing can ingest markdown image alt text.
  - **GoFloaters:** locality hop works; live detail markdown has **no lat/lng** (only a Google Static Maps embed).
  - **Coworker:** still the only source with known-good DB rows; a fresh scrape of one known URL returned null coords under current Firecrawl `onlyMainContent`, so even Coworker coord extraction may have drifted since 2026-07-23.
- Local catalog now contains the 2026-07-23 Coworker preview rows plus one live CoFynd probe row from `sync:check`; that CoFynd row is intentionally left unembedded because the check runs with `skipDownstream: true`. Backup at `backup-listings-20260730-084824.sql` (gitignored).
- `npm run sync:listings` does **not** load `.env.local` — use `npx tsx --env-file=.env.local scripts/run-listings-sync.ts` for a local full sync. `sync:preview` is Coworker-only, non-destructive, and listings-only (`trackMissing: false`, `skipDownstream: true`); `sync:check` uses a live CoFynd discovery plus one real detail scrape on the first run, skips AI downstream work, and should report zero detail scrapes on the immediate second run. Worktrees without a copied `.env.local` must point `--env-file` at the parent checkout's env file.
