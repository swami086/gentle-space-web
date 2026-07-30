# AI Search Result Insight — Design

**Date:** 2026-07-30
**Status:** Approved (brainstorming), pending spec review
**Feature:** When a user runs AI search on `/spaces`, let them reveal, per result, a grounded "Why this fits" panel that highlights the aspects relevant to their query and surfaces beneficial nearby Google Maps locations taken from the query's cues.

## Goal

For each AI-search result, on demand, explain what about the space is relevant to the user's query and show beneficial surrounding locations (from Google Maps) chosen from the query's cues.

Explicitly **out of scope**: pros/cons lists. The panel shows relevance **highlights** and **nearby** context only.

## Non-goals

- No pros/cons or "considerations" content.
- No automatic per-result generation. Insight is produced only when the user expands a result.
- No exact-address disclosure. Nearby search uses the true coordinates server-side but the client only receives place names + coarse distance labels.
- No changes to ranking. This feature is purely explanatory; vector + graph ranking is unchanged.

## Approach (selected: A — Places-grounded, LLM-phrased)

On expand, a server endpoint loads the listing's real coordinates, selects nearby categories from the query cues (with a commuter default), queries Google Places API (New), then asks Gemini to phrase query-relevant highlights grounded strictly in the provided facts. Two independent cache layers keep cost bounded: the query-independent nearby lookup is reused across searches; only the cheap phrasing varies per query.

Rejected alternatives:
- **Pure-LLM (no Places):** nearby claims would be ungrounded/hallucinated, violating the "based on Google Maps' surrounding locations" requirement.
- **Precompute at sync:** cannot take cues from the user's search, and spends tokens on listings nobody views.

## Architecture

```
User runs AI search
  POST /api/spaces/search  ->  { interpretedQuery, listings, matchedEntities }
  (matchedEntities is already computed; now plumbed to the client)

Client (SpacesBrowseClient) holds active { query, entities }, passes to each SpaceCard
  (only in search-results mode; hidden in plain browse mode)

User clicks "Why this fits" on a card
  POST /api/spaces/insight  { listingId, query, entities }
      1. Load listing (REAL db lat/lng, area, city, amenities, description, propertyType, pricingHint)
      2. selectNearbyCategories(entities) -> includedTypes[] (<=3) + labels, default fallback
      3. Nearby cache [listingId | sortedCategories] -> miss -> Places API (New) searchNearby
         (field-masked, radius ~1km, <=3 per category) -> cache (TTL ~30d)
      4. Insight cache [listingId | querySignature] -> miss -> explainListingFit(facts)
         (Gemini flash-lite, JSON mode) -> cache (TTL ~24h)
      5. Return { listingId, summary, highlights[], nearby[] }

Client caches payload in card component state (collapse/re-expand is free)
```

**Coordinate privacy:** the DB stores real coordinates; only the map pin *display* is fuzzed via `approximateCoords`. The insight endpoint uses the real coordinates for the Places query server-side and never returns exact addresses — only place names and coarse distance labels ("~350 m", "~1.2 km").

## Endpoint contract

```
POST /api/spaces/insight

Request:  { listingId: string, query: string, entities?: QueryEntities }

Response: {
  listingId: string,
  summary: string,                                   // one line: how this space maps to the query
  highlights: { label: string, detail: string }[],   // what's relevant to THIS query
  nearby: { category: string, label: string,
            places: { name: string, distanceLabel: string }[] }[]
}

Errors:
  400 invalid input (missing/oversized query, missing listingId)
  404 listing not found
  503 AI not configured (consistent with /api/spaces/search)
  502 phrasing failure
  Nearby failure is NON-FATAL: return summary + highlights with nearby omitted.
```

`entities` is supplied by the client from the search response to avoid a second Gemini entity-extraction call. It is untrusted input used only to pick nearby categories and build the cache key; `listingId` is validated against the DB. If `entities` is absent, the server falls back to the default commuter category set (it does not re-extract).

## Highlights semantics

Each highlight is a query-relevant aspect, grounded in real data, sourced from either:
- the listing itself — query amenity/desk/area that the listing satisfies (e.g. query "parking" + listing has parking -> `{label:"Parking", detail:"On-site parking"}`; area match -> `{label:"Location", detail:"In Bellandur, as you asked"}`), or
- Google Maps surroundings — query cue matched by a nearby place (e.g. "near metro" -> `{label:"Commute", detail:"Namma Metro ~400 m"}`; "coffee" -> `{label:"Cafes", detail:"3 cafes within 500 m"}`).

The Gemini prompt is constrained to only phrase facts provided in the request (listing fields + matched entities + real nearby results) and to emphasize whatever the query asked for. It must not invent places, distances, or amenities. Invalid/empty model output degrades to an empty highlights array (see failure handling).

## Components (small, single-purpose units)

| File | Purpose | Depends on |
|------|---------|------------|
| `lib/places/categories.ts` | Pure `selectNearbyCategories(entities): CategoryPlan[]` — map query entities to Places `includedTypes` + human labels, default fallback, dedupe, cap 3, stable order | none (pure) |
| `lib/places/client.ts` | `searchNearby(coords, includedTypes): NearbyPlace[]` — Places API (New) `places:searchNearby`, field-masked; `distanceLabel(meters)` pure helper | `fetch`, `GOOGLE_PLACES_API_KEY` |
| `lib/spaces/insight-types.ts` | Shared request/response + internal fact types | `lib/graph/types` (QueryEntities) |
| `lib/spaces/insight.ts` | `buildInsight({ listing, query, entities }): InsightResponse` orchestrator — category select -> nearby (cached) -> phrasing (cached), with graceful nearby degradation | places, ai client, cache |
| `lib/spaces/insight-cache.ts` | Process-local TTL cache, two namespaces (nearby, insight) | none |
| `app/api/spaces/insight/route.ts` | POST handler: validate, load listing, call `buildInsight`, map errors | db listings, insight |
| `components/spaces/SpaceInsightPanel.tsx` | Client panel: fetch on expand, render summary + highlight chips + nearby; loading/error states | — |
| `lib/ai/client.ts` (+ `lib/vertex/client.ts`, `lib/openai/client.ts`) | New `explainListingFit(facts): Promise<InsightContent>` facade + Gemini prompt; openai stub | existing AI facade pattern |

Client plumbing changes:
- `SearchResponse` in `SpacesBrowseClient` widened to include `matchedEntities`.
- `SpacesBrowseClient` stores `entities` and passes `query` + `entities` to `SpaceCard`.
- `SpaceCard` renders the "Why this fits" button + `SpaceInsightPanel` only when `query`/`entities` are present (search-results mode).

Config: `.env.example` gains `GOOGLE_PLACES_API_KEY` (may point at the same key as `GOOGLE_GEOCODING_API_KEY` once Places API (New) is enabled on the project).

## Category selection rules

Deterministic entity -> Places `includedTypes`:
- landmark "metro"/"station" -> `subway_station`/`transit_station`; "airport" -> `airport`; "mall" -> `shopping_mall`.
- amenity/keyword "coffee"/"cafe" -> `cafe`; "food"/"lunch"/"restaurant" -> `restaurant`; "gym" -> `gym`; "parking" -> `parking`; "bank"/"atm" -> `atm`.
- If nothing query-derived -> default commuter set: `transit_station`, `restaurant`, `atm`.
- Capped at 3, de-duplicated, stable order (stable cache key). Each carries a UI label ("Cafes", "Transit", "Food", "ATMs").

## Places integration

`places:searchNearby` (POST) with header `X-Goog-FieldMask: places.displayName,places.location,places.primaryType` (cheapest useful SKU). Body: `includedTypes`, `maxResultCount: 3`, `locationRestriction` circle radius ~1000 m centered on the real coordinates. One request per category (<=3 total per uncached listing). Straight-line (haversine) distance from the listing to each place is bucketed into a friendly label by a pure helper. Only names + distance labels reach the client.

## Caching

Process-local TTL cache (`lib/spaces/insight-cache.ts`), two namespaces:
- Nearby: key `listingId|sortedCategories`, TTL ~30 days (places rarely move; query-independent, so reused across all searches).
- Insight: key `listingId|querySignature` where `querySignature` = normalized sorted entities, TTL ~24 h.

```
ponytail: in-memory cache — ceiling is a single Render instance and cache is lost on restart.
Upgrade path: move the nearby namespace to a `listing_nearby` DB table if we scale horizontally.
```

## Cost controls

- On-demand only (nothing generated until a user expands a result).
- Field-masked Places requests (restricts to the cheap SKU).
- <=3 categories x <=3 places.
- Both cache layers; nearby is query-independent and long-lived.
- Gemini `gemini-2.5-flash-lite`, JSON response mode, small `maxOutputTokens`.

## Failure handling (graceful degradation)

- Places key missing / API disabled / request error -> log once, omit `nearby`, still return `summary` + `highlights` grounded in listing + query.
- Listing has no coordinates -> skip nearby (same path as above).
- Gemini error or invalid JSON -> JSON guard returns a safe empty structure; route responds 502; client shows "Couldn't generate insight — Retry" and the panel remains collapsible.
- AI not configured (`isAiSearchConfigured()` false) -> 503, matching the search endpoint.
- The nearby layer is best-effort and never blocks the core highlights.

## UI / UX

- `SpaceCard` footer gains a **"Why this fits"** button, rendered only in search-results mode.
- Clicking toggles `SpaceInsightPanel`, expanding inside the card below existing content; list + map layout stay put.
- Panel states:
  - Loading: compact skeleton ("Reading the neighborhood…").
  - Loaded: `summary` line -> **highlight chips** (query-relevant hooks) -> **Nearby** grouped by category with place + distance ("Cafes · Third Wave ~300 m").
  - Error: "Couldn't generate insight — Retry".
- Payload cached in card component state; collapse/re-expand is instant and free.
- Accessibility: real `<button>` with `aria-expanded`; panel `id` tied via `aria-controls`; text content is screen-reader friendly.
- Expanding sets the card active so the corresponding map pin emphasizes (reuses existing active-id behavior).

## Testing

Mirrors the repo's vitest + mocked-`fetch` patterns:
- `selectNearbyCategories` — pure: query cues -> correct types; default fallback when empty; dedupe + 3-cap + stable order.
- `distanceLabel` — pure bucketing.
- `lib/places/client` — mocked `fetch`: asserts field-mask header + request body shape and response parsing; error -> throws so the orchestrator degrades.
- `explainListingFit` facade — mocked vertex/openai selection + JSON parse guard (invalid JSON -> safe empty), following the existing `extractSearchEntities` test.
- `buildInsight` orchestrator — mocked places + ai: verifies both cache layers (second call does not refetch) and that a nearby failure still returns `summary` + `highlights`.
- `POST /api/spaces/insight` — invalid input (400), not found (404), success shape, nearby-degradation.
- Live check `scripts/check-insight.ts` (`npm run insight:check`) — real Places + Gemini for a known Bellandur listing; asserts non-empty `highlights` and at least one grounded nearby place. Style matches existing `graph:check`.

## Dependencies / operational notes

- Requires **Google Places API (New)** enabled on the Google Cloud project with billing, exposed via `GOOGLE_PLACES_API_KEY` (server-side).
- No database schema change (in-memory cache). A future `listing_nearby` table is the documented scale-out upgrade path only.
- No change to the listings sync pipeline or ranking.
