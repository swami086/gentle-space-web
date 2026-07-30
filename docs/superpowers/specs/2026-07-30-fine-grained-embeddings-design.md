# Fine-Grained Listing Embeddings (Structured + Description Split) — Design

**Date:** 2026-07-30
**Status:** Approved (brainstorming), pending spec review
**Feature:** Split each listing's single combined embedding into two purpose-built vectors — one for structured/categorical fields, one for free-text description — so AI search on `/spaces` stops averaging away nuance that today gets diluted into one blended vector.

## Goal

Improve AI search relevance for queries that hinge on free-text nuance (facts buried in a listing's description) without changing embedding API call volume, without touching the entity-graph layer, and without adding query-time cost.

## Problem

`buildListingEmbeddingText()` concatenates `title · area · city · propertyType · pricingHint · shortTeaser · description · amenities` into one string, embedded as a single 768-dim vector (`listings.embedding`). Short categorical fields and long free-text description get averaged together, so:
- A one-off detail mentioned once in a long description (e.g. "24/7 access") gets diluted by everything else in the vector.
- A listing that's a strong match on one specific fact but unremarkable everywhere else can't outscore a listing that's vaguely relevant throughout.

## Non-goals

- No paragraph-level chunking within descriptions. Documented as a future upgrade path (option B) if the two-field split isn't sufficient.
- No change to the entity-graph layer (Area/Amenity/DeskType/Landmark/BudgetSignal extraction, weights, or Cypher matching).
- No change to `/api/spaces/insight` or ranking beyond the vector-similarity input it already consumes.
- No change to query-side embedding cost or call count (still one embed call per search query).
- No change to the sync pacing mechanism (`lib/sync/pace.ts`) — the existing 30 items/min pacing is reused as-is.

## Approach (selected: dual-field split, MAX combination, interleaved batching)

Rejected alternatives:
- **Paragraph-level chunking of descriptions:** more faithful to "fine-grained" in the general RAG sense, but multiplies stored vectors per listing (N chunks vs. 1), multiplies embedding calls unless carefully batched, and needs chunk→listing dedup logic at query time. Overkill for single-paragraph coworking-space descriptions; kept as documented future escalation if the two-field split proves insufficient.
- **Weighted average of the two similarities:** simpler math, but partially reintroduces the dilution problem this change exists to fix — a listing that's excellent on one field and mediocre on the other gets pulled toward the mediocre score instead of being recognized as a strong match.
- **Two independent top-K candidate searches merged at the application layer:** most thorough (would also enable real ANN index usage on both columns), but adds retrieval-layer complexity not justified at current catalog scale (~700 listings).

## Data model

Replace the single `embedding vector(768)` column with two:

| Column | Built from | Purpose |
|---|---|---|
| `structured_embedding vector(768)` | `title · area · city · propertyType · pricingHint · amenities` | Categorical/factual signal |
| `description_embedding vector(768)` | `shortTeaser · description` | Free-text nuance |

Migration `lib/db/migrations/004_split_embeddings.sql` (mirrors the drop-and-recreate pattern already used in `003_pgvector_768.sql`):

```sql
DROP INDEX IF EXISTS listings_embedding_ivfflat;
ALTER TABLE listings DROP COLUMN IF EXISTS embedding;
ALTER TABLE listings ADD COLUMN structured_embedding vector(768);
ALTER TABLE listings ADD COLUMN description_embedding vector(768);
CREATE INDEX IF NOT EXISTS listings_structured_embedding_ivfflat
  ON listings USING ivfflat (structured_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS listings_description_embedding_ivfflat
  ON listings USING ivfflat (description_embedding vector_cosine_ops) WITH (lists = 100);
```

`lib/db/schema.sql` updated to match for the fresh-DB path (new deployments never see the old single-column shape).

**Entity extraction is unchanged.** `extractSearchEntitiesBatch` in `lib/graph/rebuild.ts` keeps using the existing combined `buildListingEmbeddingText()` — extraction benefits from full context and this pipeline stays untouched.

## Backfill / sync (embedding-cost-neutral)

`lib/sync/embed-listings.ts` changes its chunking from "32 listings' combined text per call" to **"16 listings × 2 texts (structured + description) = 32 texts per call"**. Same `CHUNK = 32`, same number of Vertex `embedTexts()` calls as today — just half as many listings represented per call, with results de-interleaved back into the two columns:

```
for each chunk of 16 listings:
  texts = interleave(chunk.map(buildStructuredEmbeddingText), chunk.map(buildDescriptionEmbeddingText))
  vectors = embedTexts(texts)          // one call, 32 texts
  for each listing i in chunk:
    structured   = vectors[2*i]
    description  = vectors[2*i + 1]
    updateListingEmbeddings(listing.id, { structured, description })
```

The existing pacing (`forEachChunkPaced`, 30 items/min from `lib/sync/pace.ts`) is reused unchanged — it already paces by chunk size, which is unaffected by what's inside each chunk.

One-time cost: all current listings need a full backfill into both new columns, since neither one is a superset of the old `embedding` column's input text. `listListingsMissingEmbedding()` treats a listing as needing embedding if *either* column is `NULL`, so this happens automatically via the normal sync/embed pass — no separate backfill script needed.

## Query-time behavior (MAX combination, embedding-cost-neutral)

The search query is still embedded **once** (`app/api/spaces/search/route.ts` is otherwise unchanged). `searchListingsByEmbedding()` compares that single query vector against both listing columns and takes the higher similarity per row:

```sql
SELECT *, GREATEST(
  1 - (structured_embedding <=> $1::vector),
  1 - (description_embedding <=> $1::vector)
)::float8 AS vector_similarity
FROM listings
WHERE (structured_embedding IS NOT NULL OR description_embedding IS NOT NULL)
  AND missing_runs < $2
ORDER BY vector_similarity DESC
LIMIT $3
```

The resulting `vector_similarity` flows unchanged into the existing `mergeVectorAndGraphScores()` graph-boost step — no changes needed there or downstream.

```
ponytail: GREATEST(...) in ORDER BY means Postgres can't use either IVFFlat index for
this query — it falls back to a sequential scan computing both distances per row.
Fine at today's/foreseeable scale (~hundreds to low-thousands of listings; the query
already scans k*4 candidates per the existing implementation). Ceiling: if the catalog
grows into the tens of thousands, upgrade path is two separate ANN queries (one per
column, each using its own index), unioned and deduped in application code, keeping
the max per listing — i.e. the "two independent top-K searches" alternative rejected
above, revisited only if scale demands it.
```

## Components (files touched)

| File | Change | Depends on |
|---|---|---|
| `lib/db/migrations/004_split_embeddings.sql` | New migration: drop `embedding`, add `structured_embedding` + `description_embedding` + 2 IVFFlat indexes | — |
| `lib/db/schema.sql` | Updated column/index definitions for fresh installs | — |
| `lib/listings/embedding-text.ts` | Add `buildStructuredEmbeddingText()` + `buildDescriptionEmbeddingText()`; existing `buildListingEmbeddingText()` untouched (still used for entity extraction) | none (pure) |
| `lib/sync/embed-listings.ts` | Interleaved dual-text chunking; `updateListingEmbedding` → `updateListingEmbeddings(id, { structured, description })` | `lib/ai/client`, `lib/db/listings`, `lib/sync/pace` |
| `lib/db/listings.ts` | `updateListingEmbeddings()` (replaces `updateListingEmbedding`), `searchListingsByEmbedding()` (GREATEST query), `listListingsMissingEmbedding()` (either column null) | — |
| `app/api/spaces/search/route.ts` | No logic change — same single query-embed call; consumes the same `vector_similarity` shape it already does | — |

## Testing

- `lib/listings/embedding-text.test.ts` (new) — `buildStructuredEmbeddingText()` / `buildDescriptionEmbeddingText()`: correct field inclusion/exclusion, trimming/filtering of empty fields, join behavior — mirrors the existing `buildListingEmbeddingText` test style.
- `lib/sync/embed-listings.test.ts` (updated) — asserts the interleaved chunk shape sent to `embedTexts()` and correct de-interleaving of the returned vectors back onto `structured`/`description` per listing, including an odd-numbered-chunk edge case.
- `lib/db/listings.test.ts` (new or extended, matching existing DB-layer test conventions in this repo) — SQL shape / parameter assertions for the `GREATEST(...)` query and the either-column-null `listListingsMissingEmbedding` predicate, following whatever mocking pattern the repo's existing `lib/db/listings.ts` callers already use.
- `lib/graph/rebuild.test.ts` — no changes expected (entity extraction path untouched), re-run as a regression check.
- Manual/live verification: run the sync on localhost first (per user's explicit request), confirm both columns populate for a sample listing, confirm a description-nuance query (e.g. a fact only present in one listing's free-text description) now surfaces that listing, before deploying to the GCP VM.

## Rollout

1. Implement and test locally against the local Docker Postgres.
2. Run `npm run sync:listings` (or the equivalent embed-only path) on localhost to backfill both columns for the local dataset; spot-check `/api/spaces/search` results.
3. Deploy migration + code to the GCP VM (same `gcloud compute scp` + rebuild pattern used for prior fixes this session).
4. Run the sync on the VM to backfill all 704 production listings into both new columns.
5. Spot-check `gentlespacesolutions.com` search results for a description-nuance query before considering this done.
