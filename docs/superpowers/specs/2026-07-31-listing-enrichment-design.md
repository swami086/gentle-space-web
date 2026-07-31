# Batched listing enrichment via Firecrawl Extract

Date: 2026-07-31
Status: approved (design)

## Problem

After the geocode repair and scraper fixes (location violations 69.2% → 22.5%),
the residual gap is not ranking — it is missing source data:

- **255 `coworker` rows** have both `area` and `address` empty. Title-only
  geocoding for multi-branch brands resolves to whichever branch Google guesses,
  which is how 16 listings still sit at the Bangalore city centroid.
- Pricing hints are present on all 704 rows after the price-parser fix, but a
  hint that fails `parseStoredPrice` (or has no convertible monthly figure)
  still cannot drive budget ranking.
- The normal scrape path will not fill these on its own: `coworker`'s address
  regex only accepts a strict postal form, and enrichment must not re-scrape
  every listing sequentially (cost and wall time).

Without a batched safety net at the end of sync, weak rows stay weak forever
and search keeps leaking wrong localities into location-constrained queries.

## Goals

- At the end of every listings sync, batch-enrich **weak** rows so no listing
  stays with unusable location or price when Firecrawl can recover a confident
  fact.
- Prefer the listing's own `source_url`; fall back to web-augmented extract only
  for misses.
- Write to live columns only above a **moderate confidence floor**; log misses.
- Reuse existing geocode / embed invalidation so pins and vectors refresh in the
  same sync cycle.
- Soft-fail enrichment so a Firecrawl outage never fails the sync.

## Non-goals

- Fixing the `coworker` address regex on the live page (separate scraper task;
  enrichment is the safety net, not the primary fix).
- Hard location filters or hybrid search (Phase 2 of
  `2026-07-31-dynamic-search-accuracy-design.md`).
- Parallel enrichment columns (`enriched_area`, etc.) — provenance is via an
  audit log plus confidence gating, not a second schema.
- Replacing the normal scrape path for rows that already have good data.
- Vertex AI batch prediction for this job (rejected in favour of Firecrawl
  Extract; see Alternatives).

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Queue membership | Any weak field: empty area+address, city-centroid coords, or weak/missing price |
| Source strategy | Source page first, then web search fallback |
| Write-back | Overwrite live columns only above a confidence floor |
| Scheduling | Tail of every listings sync (batched, not per-row sequential) |
| Location confidence | Moderate: medium+ confidence, or Pass 1 and Pass 2 agree on locality |
| Approach | Firecrawl `/extract` batch (Approach A) |

## Approach

### Why Firecrawl Extract

Firecrawl `/extract` accepts an array of URLs, a shared JSON schema, and optional
`enableWebSearch` / `allowExternalLinks`. One call covers Pass 1 for the whole
weak set; a second, smaller call covers Pass 2 for misses. That matches
"batched at the end" without a GCS JSONL job and without sequential scrapes.

### Alternatives rejected

**Scrape markdown → Vertex batch JSONL.** Reuses the entity-extraction batch
pipeline and is cheaper on LLM tokens, but requires sequential Firecrawl
scrapes (or a markdown cache we do not have) before the batch. Rejected because
the user requirement is batched, not sequential.

**Firecrawl Agent / search-first.** Strong for multi-branch title-only rows, but
highest cost, weakest provenance, and fights "page first".

**Separate enrichment columns.** Safer provenance, more schema and read-path
complexity. Rejected in favour of confidence-gated overwrite + audit log.

## Pipeline

Sync ordering becomes:

```
scrape → upsert → enrich → embed → geocode → graph
```

Enrichment sits **before** embed/geocode so one cycle heals location and
vectors. Soft-fail style matches today's embed/geocode hooks in
`lib/sync/run-sync.ts`.

1. **Select weak rows** from Postgres (`id`, `title`, `source_url`, `area`,
   `address`, `pricing_hint`, `lat`, `lng`), excluding rows accepted by
   enrichment within `ENRICH_COOLDOWN_DAYS` (default 7) unless they still fail
   the weak check after a content-changing scrape.
2. **Pass 1 — page extract (batched):** one Firecrawl `/extract` over all weak
   `source_url`s; `enableWebSearch: false`.
3. **Score** each result against the moderate floor.
4. **Pass 2 — web extract (batched, misses only):** second `/extract` on
   remaining URLs with `enableWebSearch: true` (and/or `allowExternalLinks:
   true`), capped by `ENRICH_WEB_LIMIT` (default 100). Accept if medium+
   confidence **or** Pass 1 and Pass 2 agree on the same normalised Bangalore
   locality.
5. **Write-back (gated):** for accepted fields only, update
   `area` / `address` / `pricing_hint`. If location changed, set `lat`/`lng` to
   `NULL` and clear `structured_embedding` + `embed_hash` (same invalidation
   contract as geocode repair).
6. **Downstream:** existing `embedListingsMissingEmbedding()` and
   `geocodeListingsMissingCoords()` pick up the cleared rows.

Failure mode: enrichment errors log and continue; a failed Pass 2 does not undo
Pass 1 writes. `ENRICH_DISABLED=1` skips the whole step.

## Weak-row definition

A listing is weak if **any** of:

- `trim(area) = ''` **and** `trim(address) = ''`
- coordinates within ~50 m of the Bangalore city centroid
  (`12.9629, 77.5775`) — same tolerance as `repair-geocodes.ts`
- `pricing_hint` empty, non-numeric, or `parseStoredPrice` yields no convertible
  `monthlyInr`

Healthy rows never enter the extract batch.

## Extract schema

Same schema for Pass 1 and Pass 2:

```json
{
  "locality": "string | null",
  "address": "string | null",
  "monthly_price_inr": "number | null",
  "price_basis": "exact | from | null",
  "brand_match": "boolean",
  "confidence": "high | medium | low",
  "evidence": "string | null"
}
```

Prompt constraints:

- Bangalore / Bengaluru only.
- `locality` must be a neighbourhood name, not a floor, door, landmark phrase,
  or bare city.
- Prefer monthly desk / seat rates; leave price null rather than invent a unit.
- `brand_match` true only when the page or result clearly refers to this
  listing's title / brand.
- Prefer null over a guess.

## Confidence gate

### Location — accept write if

- `locality` is non-empty and passes `looksLikeLocality` (rejects junk /
  scraper debris),
- the implied city is Bangalore,
- and either `confidence ∈ {high, medium}` **or** Pass 1 and Pass 2 return the
  same normalised locality.

Prefer `address` when `hasCityMarker(address)`; otherwise store `locality` into
`area` and leave `address` empty unless a full postal address was returned.

### Price — accept write if

- `monthly_price_inr` is present,
- `confidence ∈ {high, medium}`,
- `formatPricingHint` + `parseStoredPrice` produce a convertible `monthlyInr`,
- and the **current** hint is weak (empty / unparseable / no monthly figure).

Do not overwrite a usable existing price.

### Always reject

- Bare city ("Bengaluru" / "Bangalore") as locality.
- Out-of-city localities.
- `confidence: low` without Pass 1 ≈ Pass 2 agreement.
- Prices without a usable monthly figure.

## Data model

### Migration `009_listing_enrichment_log.sql`

```sql
CREATE TABLE IF NOT EXISTS public.listing_enrichment_log (
  id BIGSERIAL PRIMARY KEY,
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  pass TEXT NOT NULL CHECK (pass IN ('page', 'web')),
  accepted BOOLEAN NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listing_enrichment_log_listing_created_idx
  ON public.listing_enrichment_log (listing_id, created_at DESC);
```

Schema-qualify `public.` — the VM role's `search_path` puts `ag_catalog` first
(same footgun as migration 008).

No parallel enrichment columns on `listings`. Provenance = this log +
confidence gating.

## Modules

| Path | Role |
| --- | --- |
| `lib/firecrawl/client.ts` | Add `firecrawlExtract(urls, { prompt, schema, enableWebSearch, allowExternalLinks })` |
| `lib/sync/enrich-listings.ts` | Weak select, Pass 1/2, gate, write-back, log |
| `lib/sync/enrich-listings.test.ts` | Pure unit tests with mocked Firecrawl |
| `lib/sync/run-sync.ts` | Call enrich before embed/geocode; soft-fail |
| `lib/db/migrations/009_listing_enrichment_log.sql` | Audit table |
| `scripts/enrich-listings.ts` | Manual / dry-run entry (`npm run enrich:listings`) |

Env knobs:

- `ENRICH_DISABLED=1` — kill switch (default off on first VM deploy)
- `ENRICH_WEB_LIMIT` — max Pass 2 URLs (default 100)
- `ENRICH_COOLDOWN_DAYS` — skip recently accepted enrichments (default 7)

## Testing

Must fail first where behaviour is new:

1. Weak selector: empty loc, centroid, unparseable price included; healthy row
   excluded.
2. Gate: medium+ accepted; low rejected unless Pass1≈Pass2 locality; bare city
   and junk locality rejected.
3. Write mapping: locality → `area`; full address preferred; price via
   `formatPricingHint`; location write clears `lat`/`lng` + embeddings.
4. Cooldown: accepted enrich within N days skips Pass 1/2.
5. `run-sync` soft-fails enrich errors and still runs embed/geocode.

## Rollout

1. Land behind `ENRICH_DISABLED` (default disabled on VM).
2. Dry-run `npm run enrich:listings` against the 255 empty-loc rows; log only.
3. Hand-check ~20 accepted writes against known multi-branch brands.
4. Enable on sync; re-run `npm run search:eval`.
5. Keep `ENRICH_WEB_LIMIT` tight until Firecrawl cost is measured.

## Success criteria

- Empty `area`+`address` count falls substantially from 255.
- City-centroid count drops to a handful of truly unresolvable titles.
- Eval location-violation rate moves **double digits** down (harness noise is
  1–3 per query; only large deltas count).
- Sampled accepted writes show no increase in wrong-locality false positives.

## Relationship to existing work

- Depends on `lib/listings/address.ts` (`looksLikeLocality`, `hasCityMarker`,
  `localityFromAddress`) and `lib/sync/sources/price.ts`.
- Depends on upsert lat/lng invalidation when address/area change
  (`lib/db/listings.ts`) and `geocodeListingsMissingCoords()`.
- Complements, does not replace, fixing `coworker` location capture on the
  source page (still the highest-value scraper follow-up).
- Feeds cleaner inputs into Phase 2 hard location filters in the search
  accuracy design.
