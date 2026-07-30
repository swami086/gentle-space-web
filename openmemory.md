# OpenMemory Guide — GentleSpace_Web

## Overview

Standalone Next.js marketing + coworking listings site for **Gentle Space** (Bangalore CRE). Public repo: https://github.com/swami086/gentle-space-web. Extracted from Resume worktree `.worktrees/gentle-space-nextjs/gentle-space-web`. Primary public site: Netlify (`gentle-space-live`); sync/listings infra on Render (`gentle-space-web` + cron).

## User Defined Namespaces

- [Leave blank - user populates]

## Architecture

- **Marketing home** (`/`): static sections (Hero, Services, HowItWorks, FAQ, Founder, CTA).
- **Spaces product** (`/spaces`): Airbnb-style browse with AI search, client filters, split map, detail pages (`/spaces/[slug]`).
- **AI search**: `POST /api/spaces/search` — vector-first pgvector rank-boost; optional Apache AGE GraphRAG scoring when configured. Each listing has two embedding columns (`structured_embedding`, `description_embedding`, migration `006_split_embeddings.sql`); `searchListingsByEmbedding()` takes `GREATEST()` of both cosine similarities per row rather than averaging one blended vector.
- **AI insight**: `POST /api/spaces/insight` — on-demand "Why this fits" panel; validates UUID listing id, query (≤500 chars), and optional `QueryEntities` shape before config/DB; loads via `getListingById`, delegates to `buildInsight()`.
- **Ingest**: Firecrawl listings sync from 4 sources (Coworker, myHQ, CoFynd, GoFloaters) now runs per-source incremental discovery/plan/apply orchestration, then soft-fails downstream embedding + graph hooks. Embeddings backfill rows where either `structured_embedding` or `description_embedding` is `NULL` (via `listListingsMissingEmbedding()`); AGE sync now replaces graph state only for changed/reactivated rows while preserving the full rebuild recovery path. `sync:preview` now reuses the same incremental write path for capped Coworker runs, and `sync:check` provides a one-listing live CoFynd probe.
- **AI provider**: Vertex preferred (`AI_PROVIDER=vertex`, project `propane-galaxy-498403-n8`, `text-embedding-004` / `gemini-2.5-flash-lite`); OpenAI fallback.

## Components

| Area | Key paths |
|------|-----------|
| Browse UI | `components/spaces/SpacesBrowseClient.tsx`, `SpacesHomeHero`, `SpacesBrowseChrome`, `SpacesAiSearch`, `SpacesFiltersModal`, `SpacesMap`, `ApproxAreaMap`, `useGoogleMap`, `SpaceGallery`, `SpaceInsightPanel` |
| Search API | `app/api/spaces/search/route.ts` |
| Insight API | `app/api/spaces/insight/route.ts` — 503/400/404/502 contract; UUID validation before DB |
| Listings DB | `lib/db/*`, `docker-compose.listings.yml` (port **5433**) |
| Sync | `lib/sync/run-sync.ts`, `lib/sync/sources/*`, `scripts/run-listings-sync.ts` |
| Sync planning | `lib/sync/plan.ts`, `lib/sync/content-hash.ts`, `lib/sync/config.ts` |
| Listings migrations | `lib/db/migrations/005_incremental_sync.sql`, `006_split_embeddings.sql`, `007_entity_extraction_cache.sql` |
| Entity extraction cache | `lib/db/listings.ts`, `lib/db/migrations/007_entity_extraction_cache.sql`, `scripts/submit-entity-extraction.ts`, `scripts/apply-entity-extraction.ts` |
| Embeddings | `lib/sync/embed-listings.ts`, `scripts/backfill-embeddings.ts` |
| GraphRAG | `lib/graph/*`, migration `004_age.sql`, `npm run graph:rebuild` (SQL-only after `entities:apply`) |
| AI facade | `lib/ai/client.ts` → `lib/vertex/*` or `lib/openai/*` |
| Nearby places (AI insight) | `lib/places/types.ts`, `lib/places/categories.ts`, `lib/places/client.ts`, `lib/places/distance.ts` — maps `QueryEntities` → Places `includedTypes`; `searchNearby()` + `distanceBand()` (coarse bands, not metre labels) |
| Listing redaction | `lib/listings/redact.ts` — `redactSensitiveText()` drops sensitive sentences; `sanitizeArea()` keeps short locality-only area strings; `displayLocationLine()` for cards/detail |
| AI insight prompt (Why this fits) | `lib/spaces/insight-types.ts`, `lib/spaces/insight-prompt.ts` — evidence-bound fact packet (stable IDs), JSON user payload, model returns evidence ID selections only; server renders exact listing/Places facts into `{ summary, highlights }`; no pricing facts; listing description redacted via `redactSensitiveText()` before fact packet and cache fingerprint |
| Entity signature (client-safe) | `lib/spaces/entity-signature.ts` — `canonicalizeQueryEntities()` + `entitySignature()` for SpaceCard remount keys; no Node/server imports |
| AI insight orchestrator | `lib/spaces/insight.ts`, `lib/spaces/insight-cache.ts` — `buildInsight()` ties category selection, Places nearby (best-effort), and `explainListingFit()` with two-layer in-memory cache (nearby 30d, insight 24h) |
| Listings lookup | `lib/db/listings.ts` — `getListingBySlug()`, `getListingById()` share visibility filter (`missing_runs < limit`) |
| Listing privacy (read boundary) | `lib/listings/public.ts` — `PublicListing`, `toPublicListing()` strips exact coords/address/pricing/sourceUrl; redacts prose via `redact.ts`; approx circle center = `approximateCoords` + 3-decimal round, `approxRadiusM = 500` |

## Patterns

- Listing privacy read boundary: `app/spaces/page.tsx`, `app/api/spaces/search/route.ts`, and `app/spaces/[slug]/page.tsx` all map DB rows through `toPublicListing()` before HTML/JSON; `PublicListing` uses `?: never` on forbidden fields. Cards/detail show `displayLocationLine()` and fixed "Ask for pricing" copy (budget filter removed).
- Spaces filters stay pure in `lib/listings/filterListings.ts` (typed on `PublicListing`).
- `SpacesBrowseClient` owns idle hero ↔ browse chrome mode; failed AI search snaps back to `initialListings`. On successful search it stores `activeQuery` + `searchEntities` (`matchedEntities` from API) and passes them to `SpaceCard`; both clear on `handleClear` and `restoreSyncCatalog`.
- `SpaceInsightPanel` (`components/spaces/SpaceInsightPanel.tsx`) renders only after a successful AI search (`searchQuery` set on `SpaceCard`); on-demand POST to `/api/spaces/insight` with in-component cache; remounted via `key={listingId:searchQuery:entitySignature}` on `SpaceCard` using client-safe `lib/spaces/entity-signature.ts` (not server `insight.ts`).
- `buildInsight()` caches two layers in a bounded process-local store (max 500 entries, LRU refresh on read, expired entries pruned on write): query-independent nearby (`listingId|categories`, 30d) and insight selection (`listingId|sha256(JSON fingerprint)`, 24h) where the fingerprint is canonical JSON over normalized query, entities, listing facts, and sorted nearby `[name,distanceLabel]` tuples (no delimiter framing); concurrent misses dedupe via per-key single-flight; empty AI content is never cached and failed nearby lookups are never cached. Gemini selects query-relevant evidence IDs from the JSON fact packet; the server renders every user-visible factual sentence from exact supplied facts (stricter grounding than LLM phrasing).
- Listing embeddings are split into `structured_embedding` (title/area/city/propertyType/pricingHint/amenities, via `buildStructuredEmbeddingText()`) and `description_embedding` (shortTeaser/description, via `buildDescriptionEmbeddingText()`), both built in `lib/listings/embedding-text.ts`. `lib/sync/embed-listings.ts` embeds both per listing in one interleaved Vertex call (`LISTINGS_PER_CHUNK = 16` listings × 2 texts = 32 texts/call, same batch size as before the split); `listListingsMissingEmbedding()` treats either column being `NULL` as needing embedding, so backfill is automatic via the normal sync/embed pass. Entity extraction (`lib/graph/*`) is untouched and still uses the original combined `buildListingEmbeddingText()`.
- Batch entity extraction now uses `VERTEX_BATCH_BUCKET` plus the two-step `entities:submit` / `entities:apply -- <job>` flow. `entities:apply` writes `extracted_entities` + `entities_hash` from the batch result and already rebuilds the graph; `npm run graph:rebuild` is the SQL-only recovery path afterward.
- `selectNearbyCategories()` maps query entities to Places `includedTypes` deterministically (max 3, stable order for cache-key stability) with a transit/food/ATM commuter default.
- `npm run insight:check` live-checks Places + Gemini end-to-end for one Coworker listing with real coordinates; asserts non-empty highlights and at least one nearby place.
- Sync soft-fails embed + graph rebuild after successful listing write.
- Sync hashes are split into content vs embed scope in `lib/sync/content-hash.ts`; both normalize amenity ordering with `buildListingEmbeddingText()` still as the embedding-text source of truth for content hashing.
- Fine-grained embedding text builders in `lib/listings/embedding-text.ts`: `buildStructuredEmbeddingText()` (categorical fields) and `buildDescriptionEmbeddingText()` (shortTeaser + description) share private `joinTextParts()` with `buildListingEmbeddingText()`.
- Embed sync interleaves structured + description texts per listing into one `embedTexts()` call (16 listings × 2 = 32 texts/chunk) via `interleaveTexts()` in `lib/sync/embed-listings.ts`; de-interleaves vectors to `updateListingEmbeddings()`. Paced by `forEachChunkPaced()` in `lib/sync/pace.ts` (`LISTINGS_PER_CHUNK=16`, `ITEMS_PER_MINUTE=30`).
- `runListingsSync()` now processes each adapter independently: `discover()` → `listExistingForSource()` → `planSourceSync()` → bounded detail scrapes → one `applySourceSync()` call, with source-local failures captured in `sync_runs.sources` and no shared full-replace abort threshold.
- `scripts/preview-listings-sync.ts` is now a thin Coworker-only wrapper around `runListingsSync({ adapters: [coworkerAdapter], maxDetailScrapes, trackMissing: false, skipDownstream: true })`, so preview runs are capped, non-destructive, and do not spend downstream embedding/graph tokens.
- `scripts/check-incremental-sync.ts` performs a live CoFynd operational check by constraining discovery to one usable listing, forcing one first-run detail scrape with `ttlMs: 1`, then proving the immediate second run scrapes zero details with `trackMissing: false` and `skipDownstream: true`.
- Source adapters now split discovery from detail scraping: `discover()` returns canonical `{ sourceId, url }` items, `fetchDetail(url)` parses one detail page, and Firecrawl only requests `links` during discovery scrapes.
- Discovery callers that read Firecrawl `links` must now opt in with `{ includeLinks: true }`; markdown-only is the default for detail scrapes and any other callers not consuming links.
- Incremental DB primitives in `lib/db/listings.ts` now back the live orchestrator: per-source upsert/touch/hide keeps `id`/`slug` stable, uses a 7-day detail TTL by default (`LISTING_DETAIL_TTL_DAYS`), preserves embeddings unless `embed_hash` changes, soft-hides rows after 3 successful unseen runs by default (`LISTING_MISSING_RUNS_LIMIT`), and dedupes cross-source variants at vector-search read time.
- `embedListingsMissingEmbedding()` chunks via `forEachChunkPaced` (16 listings/chunk), interleaves structured + description embedding texts into one Vertex call per chunk, and writes both columns via `updateListingEmbeddings()`; `scripts/backfill-embeddings.ts` fills missing vectors only.
- `syncListingGraph(changed)` now prepares extraction for every changed/reactivated listing before the first AGE write, then calls `replaceListingGraphs()` for the batch. Soft-hidden `Listing` nodes intentionally remain in AGE until `graph:rebuild`; vector search filters hidden SQL rows before graph scoring, and `rebuildListingGraph()` still does wipe-once + `upsertListingGraphs()` recovery.
- AGE cypher string literals inside PostgreSQL `$$...$$` must escape apostrophes as `\'` (not SQL `''`); `sanitizeCypherLiteral()` strips backslashes/controls and rejects `$$`. `GRAPH_SEED_ONLY=1` skips Vertex entity extract for a fast seed-only rebuild.
- Map circles use `approxLat`/`approxLng`/`approxRadiusM` from `toPublicListing()`; shared `useGoogleMap()` loads Maps JS once per component; `SpacesMap` draws browse circles with title-only info windows; detail page uses `ApproxAreaMap` (~zoom 14) with text fallback when key/coords missing. `MapEmbed` removed.
- 2026 Google Maps research baseline for `Spaces`: prefer client-only `@vis.gl/react-google-maps` in Next.js App Router, use cloud `mapId`, render price pins with `AdvancedMarker`, and reuse map instances where practical to avoid extra map-view cost.

## Local runtime setup (verified 2026-07-30)

Runtime config is **not in git** — it was copied from `~/Documents/Resume/gentle-space-web/`:

- `.env.local` — `DATABASE_URL`, `AI_PROVIDER=vertex`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`, `VERTEX_*` models, `FIRECRAWL_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY`, `GOOGLE_GEOCODING_API_KEY`, `GOOGLE_PLACES_API_KEY` (server-only; Places API (New)). `GOOGLE_MAPS_EMBED_KEY` is legacy/unused (MapEmbed removed). `GOOGLE_APPLICATION_CREDENTIALS` must be rewritten to this workspace's absolute path.
- `.secrets/gentle-space-vertex-stackgen.json` (+ `gentle-space-vertex.json`) — Vertex SA keys, mode `600`. Both are gitignored (`.env*`, `.secrets/`) — keep it that way, the remote is public.

**Docker:** the pgvector+AGE volume was created by the Resume folder, so compose must pin the original project name or a new empty volume is used instead:

```bash
docker compose -p gentle-space-web -f docker-compose.listings.yml up -d
```

Persisted volume `gentle-space-web_gentle_space_pgdata` already contains the applied schema (AGE 1.6.0, vector 0.8.1, `structured_embedding` / `description_embedding` `vector(768)` per migration `006`) and 11 listings with both columns populated (10 Coworker preview rows from 2026-07-23 plus one live CoFynd probe row) after the 2026-07-30 backfill — so schema/migrations and `sync:preview`/`embed:backfill` do **not** need re-running for local preview.

## Known issues / ops state

- **AGE graph boost fixed (2026-07-30).** Root cause was `label(e)[0]` in `scoreListingsAgainstQuery()` — Apache AGE's `label()` returns a scalar string, so indexing it threw Postgres `22023` / `agtype_access_operator`. The unused `elabel` projection was dropped; scoring buckets by `type(r)` only. Verified by a direct Bellandur AGE probe (`overlap: 3` for `cowrks-ecoworld-cowrks-ecowo`) and live `POST /api/spaces/search` with no fresh graph-fallback log on the active dev server.
- `npm run graph:check` can still fail after `sync:check` inserts the live CoFynd probe row: the script grabs the first listing with any `area`, and that CoFynd detail currently stores malformed markdown-alt text in `area`, which produced `overlap: 0` for `corporatedge-ub-city-corporatedge` during Task 8 verification even though Bellandur rows still score.
- Render cron `gentle-space-listings-sync` (`crn-d9h1qfsm0tmc738a6u0g`) still **paused since 2026-07-26** (intentionally left paused).
- **Do not resume the 4-source live sync yet.** The risk is source-quality gaps under the incremental pipeline, not a missing full-replace path. Live Firecrawl probes (2026-07-30) found adapter discovery/coord gaps:
  - **myHQ:** `/map` alone returns locality indexes, not details. Detail URLs (`/dedicated/coworking-space/{slug}`) appear only after hopping a locality page. Adapter needs a GoFloaters-style locality hop. Once on a detail page, coords parse correctly (strict pair in Bengaluru).
  - **CoFynd:** discovers real detail slugs from the Bangalore index, but `gurugram` leaks through `CITY_SLUGS` (alias of `gurgaon`). Live detail markdown has **no lat/lng**; area parsing can ingest markdown image alt text.
  - **GoFloaters:** locality hop works; live detail markdown has **no lat/lng** (only a Google Static Maps embed).
  - **Coworker:** still the only source with known-good DB rows; a fresh scrape of one known URL returned null coords under current Firecrawl `onlyMainContent`, so even Coworker coord extraction may have drifted since 2026-07-23.
- Local catalog now contains the 2026-07-23 Coworker preview rows plus one live CoFynd probe row from `sync:check` (inserted with `skipDownstream: true`, but both embedding columns were filled by the 2026-07-30 backfill). Backup at `backup-listings-20260730-084824.sql` (gitignored).
- `npm run sync:listings` does **not** load `.env.local` — use `npx tsx --env-file=.env.local scripts/run-listings-sync.ts` for a local full sync. `sync:preview` is Coworker-only, non-destructive, and listings-only (`trackMissing: false`, `skipDownstream: true`); `sync:check` uses a live CoFynd discovery plus one real detail scrape on the first run, skips AI downstream work, and should report zero detail scrapes on the immediate second run. Worktrees without a copied `.env.local` must point `--env-file` at the parent checkout's env file.
