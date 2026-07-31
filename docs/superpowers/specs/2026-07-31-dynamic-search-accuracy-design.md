# Dynamic search accuracy: geo repair, hard filters, hybrid retrieval

Date: 2026-07-31
Status: approved (design)

## Problem

AI search is a single dense-vector stage with a small additive graph boost. A manual
evaluation on 2026-07-31 found four failure modes, and tracing them through the code
shows they share a handful of root causes.

Observed failures:

- "Whitefield + parking" ranked parking-heavy listings in other localities above
  Whitefield listings.
- Landmark and soft-amenity queries ("near metro", "quiet") had no reliable signal.
- Blank and dirty `area` values weakened locality matching.
- "under 15k" influenced the embedding but was never enforced or displayed.

Root causes, with file references:

1. **No lexical retrieval.** `searchListingsByEmbedding` (`lib/db/listings.ts:168-199`)
   ranks only by cosine similarity over `structured_embedding` and
   `description_embedding`. Rare proper nouns like "Whitefield" are exactly what dense
   embeddings blur and keyword scoring nails.
2. **No hard filters.** The only SQL predicates are `missing_runs < $2` and a not-null
   embedding check. Area, budget, and desk type never reach the database.
   `applySpacesFilters` (`lib/listings/filterListings.ts:15-51`) is a real filter but
   runs client-side in `components/spaces/SpacesBrowseClient.tsx:54` on the 10 rows the
   API already returned, so it can only shrink a page, never recover a better listing.
3. **The boost cannot rescue a missed listing.** `GRAPH_VECTOR_K` defaults to 20 and the
   normalized graph term is capped by `λ = 0.35` (`lib/graph/score.ts:23-36`). A perfect
   entity match ranked 21st by vector similarity is unreachable.
4. **Queries are embedded with the wrong task type.** `lib/vertex/client.ts:57` sends
   `task_type: "RETRIEVAL_DOCUMENT"` for both listing text and user queries.
   `text-embedding-004` expects `RETRIEVAL_QUERY` on the query side, so every search
   made today is degraded.
5. **Entity matching is exact string equality** (`lib/graph/age.ts:268-284`), so "hsr"
   never matches "hsr layout".
6. **No numeric price exists.** Only free-text `pricing_hint`, and `pricingHint` is typed
   `never` on `PublicListing` (`lib/listings/public.ts:24`), stripped by
   `toPublicListing`.
7. **No relevance measurement exists.** `app/api/spaces/search/route.test.ts` asserts
   JSON shape only. Nothing computes precision or nDCG, so accuracy changes are
   currently unfalsifiable.

Underneath all of it sits a data-integrity bug. `sanitizeArea` takes the **leading
fragment** of the scraped address rather than the locality buried later in it, so
`hustlehub`'s address "2nd & 3rd Floor, #108, ... 27th Main Road, Sector 2, HSR Layout"
yields the area `2nd & 3rd Floor`. `geocodeQuery` (`lib/sync/geocode-listings.ts:19-26`)
then feeds that junk to the Geocoding API, which resolves it confidently and wrongly.

## Goals

- Enforce location and budget constraints in SQL, not by ranking hint.
- Recover locality information for the 36% of listings with a blank `area`.
- Make rare proper nouns retrievable.
- Repair coordinates that are currently wrong, and never store a guess again.
- Make every subsequent accuracy change measurable.

## Non-goals

- External reranker vendors (Cohere, Voyage) or a self-hosted cross-encoder. Deferred
  until the eval harness shows hybrid retrieval plus filters is insufficient.
- Changing the entity taxonomy or the extraction prompts.
- Re-scraping sources. All repairs use data already in Postgres plus the Geocoding API.
- Exposing exact prices. Only coarse bands reach the client.

## Validation performed

Every load-bearing assumption below was checked against the live Geocoding API and the
local 704-listing database on 2026-07-31, before this design was written.

**Bounds-filtering strictly beats text matching.** Filtering by Google's returned bounds
rectangle recovers 35-72% more listings and loses none:

| Locality | `area` text match | Inside bounds | Recovered blank-area | Text match outside bounds |
|---|---|---|---|---|
| Whitefield | 31 | 42 | 3 | 0 |
| Indiranagar | 43 | 74 | 14 | 0 |
| Koramangala | 42 | 64 | 19 | 0 |
| HSR Layout | 52 | 85 | 23 | 0 |

The final column being zero everywhere means bounds-filtering is a strict superset of
text matching; the switch cannot regress recall.

**A fixed radius would have been wrong.** Locality bounds vary by roughly 7x, so the
design stores Google's bounds rectangle per area rather than a constant radius:

| Query | Bounds N-S | E-W | `types` | `partial_match` |
|---|---|---|---|---|
| Electronic City | 6.3 km | 7.2 km | political, sublocality | false |
| Whitefield | 4.9 km | 6.7 km | political, sublocality | false |
| HSR Layout | 3.4 km | 5.0 km | political, sublocality | false |
| Indiranagar | 2.8 km | 2.1 km | political, sublocality | false |
| HSR Layout Sector 2 | 0.9 km | 1.1 km | political, sublocality | false |
| Koramangala 5th Block | 0.9 km | 1.7 km | political, sublocality | false |

Sub-localities resolve cleanly, so "Koramangala 5th Block" is supportable. Metro stations
return correct coordinates but no bounds (`establishment`, `point_of_interest`), so
landmarks need a fixed radius instead.

**Bad coordinates are detectable, but `partial_match` alone is not sufficient.**

| Input | `partial_match` | `location_type` | Result | Verdict |
|---|---|---|---|---|
| `28/1, Bengaluru, India` | true | APPROXIMATE | "Bengaluru, Karnataka, India" | city fallback |
| `No. 41, Bengaluru, India` | true | APPROXIMATE | "Bengaluru, Karnataka, India" | city fallback |
| `2nd & 3rd Floor, Bengaluru, India` | **false** | ROOFTOP | a building in Nagarbhavi | confidently wrong |
| `Metropolis Office Park Plot No: 128-P2` | true | ROOFTOP | EPIP Zone, Whitefield | correct |

`partial_match` is false for the Nagarbhavi case and true for a correct result, so it is
not a usable gate. The reliable rejection signal is a result that resolves only to the
city: `types` containing `locality` with a formatted address of "Bengaluru, Karnataka,
India". In the database, 39 listings sit at that exact centroid (12.9629, 77.5775) and 73
have `area` values containing digits, `floor`, `plot`, `no.`, or leftover `svg`.

**The repair cascade works.** Geocoding the full scraped address returns ROOFTOP
precision plus a sublocality hierarchy (5/5 tested). Business-name geocoding succeeds for
7/10, and all 3 failures are the detectable city fallback:

| Address input | Precision | Sublocality components |
|---|---|---|
| `...27th Main Road, Sector 2, HSR Layout` | ROOFTOP | Parangi Palaya, Sector 2, HSR Layout |
| `Metropolis Office Park Plot No: 128-P2, EPIP ZONE` | ROOFTOP | EPIP Zone, Whitefield |
| `28/1, ...Sahakar Nagar` | ROOFTOP | Sahakar Nagar, Byatarayanapura |
| `No. 41, ...Konena Agrahara` | GEOMETRIC_CENTER | Konena Agrahara, Murgesh Pallya |

`address` is populated for 449 of 704 listings. Where address and business name disagree
(`OfficeBing` resolves to Sahakar Nagar by address, Koramangala by name), the address is
authoritative.

**No spatial index is needed yet.** `EXPLAIN ANALYZE` on a bounding-box predicate is a
sequential scan over 704 rows in 0.30 ms. A GiST index becomes worthwhile somewhere north
of ~50k listings; the implementation records that ceiling in a comment rather than adding
an index now.

**Existing `ivfflat` indexes become a liability under filtering.** Once hard filters
shrink the candidate pool, approximate search can miss eligible rows that an exact scan
finds. At this corpus size the dense arm should use an exact KNN scan, which is both
faster and strictly more accurate.

## Approach

Four phases. Phase 0 is a prerequisite: search changes that trust coordinates cannot land
before the coordinates are trustworthy.

### Phase 0 - Geocode integrity repair

Fix the extraction bug, then re-derive location for every affected listing.

`sanitizeArea` (`lib/listings/redact.ts`) stops returning the leading address fragment. It
strips scraper markdown and SVG artifacts as today, then rejects any candidate that is not
a plausible locality — containing digits, or `floor`, `plot`, `no.`, `block no`, `#`. A
rejected candidate yields an empty area rather than junk.

`lib/sync/geocode-listings.ts` gains a resolution cascade, trying each source in order and
stopping at the first accepted result:

1. Cleaned `address` (markdown-stripped) — highest precision, covers 449 rows.
2. `title` as a business name — recovers roughly 70% of the remainder.
3. `sanitizeArea(area)` — only when it passes the plausible-locality check.
4. Otherwise leave `lat`/`lng` NULL.

Every candidate result passes an acceptance gate that rejects city-only resolutions
(`types` includes `locality` and the formatted address is the bare city). Rejection sets
NULL; it never stores a fallback point.

Each accepted result also persists `geo_components TEXT[]` — the sublocality hierarchy
from `address_components` — and a `geo_precision TEXT` recording `ROOFTOP`,
`GEOMETRIC_CENTER`, or `APPROXIMATE`. The display area becomes the most specific component
that matches a known locality, replacing the junk-prone `area` string for presentation.

A one-off `scripts/repair-geocodes.ts` re-resolves the 89 known-bad rows through the same
cascade, so the script and the sync path share one code path. That figure is the union of
39 rows at the city centroid and 73 with implausible `area` values, which overlap by 23.
The 255 blank-area rows are re-resolved too: they currently hold title-derived coordinates,
and the address path is more precise where an address exists.

### Phase 1 - Measurement, and the one-line fix

`lib/vertex/client.ts` gains a `taskType` parameter so query embedding uses
`RETRIEVAL_QUERY` while listing embedding keeps `RETRIEVAL_DOCUMENT`. This is a one-line
behavioural change affecting every search, so it lands with the harness that can prove it.

The harness is `scripts/eval-search.ts` reading `docs/eval/golden-queries.json`, and it
reports two metrics:

- **Constraint-violation rate (primary).** Objective and requires no human labels. For
  "coworking in Whitefield under 15k with parking", assert every returned listing falls
  inside Whitefield's bounds and has `price_monthly_inr <= 15000`. Any violation is a
  hard failure.
- **nDCG@10 (secondary).** Roughly 10 soft queries ("quiet space for calls") with
  hand-checked labels, drafted by the implementer for the user to correct.

Both run against the local database and print a before/after table so each later phase
reports its own delta.

### Phase 2 - Structured constraints as hard filters

Location and budget become SQL predicates. Amenities remain soft ranking signals.

An `areas` table caches resolved localities: `name` (normalized), centroid, bounds
rectangle, `types`, `resolved_at`. A query area is looked up here first and geocoded once
on a miss, so repeated searches cost no API calls.

Price parsing lands in a new `lib/listings/price.ts`, populating `price_monthly_inr INTEGER`
and `price_basis TEXT` (`exact` | `from` | `unknown`) during sync. Day rates multiply by 22
working days. `from ₹300/month` stores 300 with basis `from`.

Filter semantics:

- **Location: strict.** Listing coordinates must fall inside the resolved bounds
  rectangle, or `geo_components` must contain the requested area name (multi-granularity,
  so "HSR Layout" matches `[Parangi Palaya, Sector 2, HSR Layout]`). Listings with NULL
  coordinates are excluded from location-constrained searches and unaffected otherwise.
- **Landmarks: strict, fixed radius.** 1.5 km from the resolved point, since points carry
  no bounds.
- **Budget: strict, conservative.** `price_monthly_inr <= limit`. Rows with basis `from`
  are included but must be labelled in the UI. Rows with `unknown` are not excluded on
  price.
- **Amenities and desk type: soft.** Ranking signals only.

`PublicListing` gains a coarse `priceBand` (`under-5k`, `5-10k`, `10-15k`, `15-25k`,
`25k-plus`) with a `from` qualifier. The exact figure stays server-side, preserving the
privacy-masking intent of `pricingHint?: never` while letting a user see why a result
matched their budget.

### Phase 3 - Hybrid retrieval with three-way RRF

Both retrieval arms share one generated `WHERE` fragment from Phase 2, so filters apply
before ranking and the top-K budget is spent only on eligible listings. K rises from 20 to
50 per arm, which is affordable precisely because filtering shrinks the pool first.

- **Dense arm.** Exact KNN cosine scan over the two embedding columns, filtered.
- **Lexical arm.** A generated `search_tsv tsvector` column over title, display area,
  `geo_components`, amenities, and property type, with a GIN index, queried through
  `websearch_to_tsquery` and ranked by `ts_rank_cd`. This is what makes "Whitefield"
  retrievable.
- **Graph arm.** Existing AGE entity overlap, ranked by weighted overlap descending.

The three ranked lists fuse through `rrfFuse` in a new `lib/search/rrf.ts` — a pure
function over rank lists using the standard `1/(k + rank)` with `k = 60`. Rank-based
fusion sidesteps the score-incompatibility problem of adding a cosine similarity to a
weighted entity count, and it removes the `GRAPH_BOOST_LAMBDA` knob entirely.
`mergeVectorAndGraphScores` and `graphBoostLambda` are deleted along with it.

Entity matching in `lib/graph/age.ts` also relaxes from exact equality to normalized
containment, so "hsr" matches "hsr layout".

## Schema changes

Two migrations, following the existing numbered convention (latest is
`007_entity_extraction_cache.sql`).

`lib/db/migrations/008_geo_components.sql` (Phase 0):

- `listings.geo_components TEXT[]` — sublocality hierarchy from `address_components`.
- `listings.geo_precision TEXT` — `ROOFTOP` | `GEOMETRIC_CENTER` | `APPROXIMATE`.

`lib/db/migrations/009_search_filters.sql` (Phases 2-3):

- `listings.price_monthly_inr INTEGER`, `listings.price_basis TEXT`.
- `listings.search_tsv tsvector` generated column, plus a GIN index.
- `areas` table: `name TEXT PRIMARY KEY` (normalized), `lat`, `lng`,
  `bounds_sw_lat`, `bounds_sw_lng`, `bounds_ne_lat`, `bounds_ne_lng`, `types TEXT[]`,
  `resolved_at TIMESTAMPTZ`. Null bounds mark a point-only result such as a metro station.

No index on `lat`/`lng`, per the 0.30 ms measurement. The implementation records the
~50k-row ceiling and the GiST upgrade path in a comment beside the filter builder.

The two `ivfflat` indexes from `006_split_embeddings.sql` are dropped in `009`. Under a
filtered query they can return fewer eligible rows than exist, and at 704 rows an exact
scan is both faster and complete. They are recreated when the corpus makes approximate
search worthwhile, which the eval harness will detect as a recall regression.

`price_monthly_inr`, `geo_components`, and `search_tsv` are all derived, so they follow the
existing embedding-invalidation pattern in `lib/db/listings.ts:322-329` — recomputed when
source content changes, never authored by hand.

## Decisions and rationale

| Decision | Choice | Why |
|---|---|---|
| Constraint strictness | Strict location + budget, soft amenities | Users treat locality and budget as non-negotiable; amenities as preferences |
| Mixed price formats | Normalize to monthly, keep `from` but label it | Day rate x 22; excluding `from` rows loses real inventory, hiding the basis misleads |
| Price display | Coarse band only | Enforces budget without undoing the privacy-masking design |
| Graph fusion | Third RRF list | Removes score incompatibility and deletes the λ tuning knob |
| Bad coordinates | Re-geocode before shipping search changes | Strict location filtering on wrong coordinates hides good listings |
| Sequencing | Eval harness before accuracy changes | Otherwise every later phase is unfalsifiable |
| Reranker | Deferred | No new vendors; revisit only if the eval shows filters plus hybrid is short |

## Alternatives rejected

**Fuse entirely in SQL (one CTE query).** One round trip and filters apply before ranking,
but the fusion becomes a large hand-written SQL block. Existing DB tests assert SQL
substrings against a mocked pool, so a fusion bug would pass silently. Two queries against
local Postgres cost far less than the two LLM calls already in the request path.

**Hard filters plus LLM rerank of the top 20, no lexical arm.** Reuses the existing Gemini
key, but does not fix the actual failure: rare proper nouns never enter the candidate set
for the LLM to promote. It also adds a third LLM call and makes ranking non-deterministic,
which fights the eval harness.

**Fixed-radius location filter.** Simpler, but measured bounds vary from 0.9 km to 7.2 km.
A radius tuned for Whitefield swamps HSR Layout Sector 2; one tuned for the sector loses
most of Whitefield.

**Text matching on `area` for location.** 36% of listings have no area string and 73 have
junk. Measured recall is 35-72% worse than bounds-filtering with no compensating benefit.

**Trusting `partial_match` as the geocode quality gate.** It is false for a confidently
wrong result and true for a correct one. Rejected in favour of the city-resolution check.

**PostGIS.** Real spatial types and operators, but a bounding-box comparison over 704 rows
runs in 0.30 ms. A new extension in the Docker stack and on the VM buys nothing today.

## Testing

- `lib/listings/redact.test.ts` — extended: junk area candidates (`2nd & 3rd Floor`,
  `28/1`, `No. 41`, markdown blobs) return empty rather than junk; real localities survive.
- `lib/sync/geocode-listings.test.ts` — extended: cascade order (address, then title, then
  area), city-only rejection sets NULL, `geo_components` persisted, quota abort preserved.
- `lib/listings/price.test.ts` — new: `₹5999 /Month`, `₹ 6500/month`, `from ₹300/month`,
  `₹600/day`, and unparseable input map to the right amount and basis.
- `lib/search/rrf.test.ts` — new: pure-function fusion over hand-built rank lists,
  including a listing present in one list only, ties, and empty lists.
- `lib/db/listings-search.test.ts` — extended: filter fragment appears in both arms;
  location-constrained queries exclude NULL coordinates.
- `app/api/spaces/search/route.test.ts` — extended: graph arm failure degrades to
  dense+lexical fusion rather than erroring.
- `scripts/eval-search.ts` — the integration check, run against the local database.

## Verifiable success criteria

Measured by `scripts/eval-search.ts` against the local 704-listing database.

**Accuracy**

- Constraint-violation rate on location-and-budget queries: **0%**. Any listing outside
  the requested bounds or over budget is a hard failure.
- nDCG@10 on the soft-query set: no regression against the Phase 1 baseline at any later
  phase.
- "Whitefield + parking" returns Whitefield listings only, drawn from the measured 42
  rather than the text-matched 31.

**Latency** (search endpoint, p50/p95/p99: 900 ms / 2500 ms / 4000 ms)

The budget is dominated by the two existing LLM calls. The database portion — two filtered
retrieval arms plus the graph query — must stay under 50 ms p95, which the measured 0.30 ms
bounding-box scan and 704-row corpus make comfortable. Cached `areas` lookups add no API
call; a cache miss adds one Geocoding round trip (~150 ms) once per new locality.

**Availability and recovery**

- Uptime target 99.5% for the search endpoint. Each arm degrades independently: a graph or
  lexical failure still returns fused results from the surviving arms, matching the
  existing try/catch posture in `app/api/spaces/search/route.ts:64-66`.
- RPO 24 h, RTO 1 h. All derived columns (`price_monthly_inr`, `geo_components`,
  `search_tsv`, embeddings) are reproducible from `listings` plus the sync pipeline, so
  recovery is a re-derivation rather than a restore.

## Risks and open items

- **Geographic truth versus scraped labels.** Bounds-filtering surfaces listings whose
  scraped area says "Bellandur" while sitting inside HSR Layout's bounds. That is correct
  behaviour, but a card showing "Bellandur" in HSR results looks wrong. The Phase 0
  display area derived from `geo_components` mitigates this; Phase 2 should show the
  matched component.
- **Coordinates are locality centroids for many listings.** 704 rows resolve to 251
  distinct points. Phase 0 improves this for repaired rows, but locality-level precision
  means sub-kilometre claims ("500 m from the metro") are not defensible. The 1.5 km
  landmark radius is chosen accordingly, and copy should say "near", not a distance.
- **Repair coverage is an estimate.** 70% business-name success is measured on a 10-row
  sample. The actual NULL count after Phase 0 is unknown until the script runs; it is
  reported rather than assumed.
- **Multi-branch brands are inherently ambiguous.** `BHIVE Workspace` has several
  locations, so business-name geocoding cannot disambiguate. These rely on the address path
  or end as NULL.
- **`from` prices remain a trust risk.** Even labelled, a `from ₹300/month` listing ranking
  inside a "under 15k" search may disappoint. The band display is the mitigation; if the
  eval shows these dominating budget queries, consider ranking `exact` above `from`.
