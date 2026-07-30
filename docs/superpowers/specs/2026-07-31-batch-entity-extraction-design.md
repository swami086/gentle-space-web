# Batch entity extraction via Vertex AI batch prediction

Date: 2026-07-31
Status: approved (design)

## Problem

`rebuildListingGraph()` extracts graph entities for all 704 listings through online
Gemini `generateContent` calls. On a fresh project with low Gemini quota this fails:

- A full rebuild on 2026-07-30 ran 33 minutes, hit `429 RESOURCE_EXHAUSTED`, and
  circuit-broke to seeded entities only.
- Because the rebuild wipes the graph before upserting, a late failure left the
  graph at 0 nodes until a seed-only recovery run.
- Online pacing (one call per ~2 minutes) is the only defence, so every full
  rebuild costs ~30 minutes of wall time and stays quota-fragile.

Seeded-only entities leave `Landmark` and `BudgetSignal` node types empty, which
also dilutes the graph rank boost: `maxPossibleOverlap()` is computed from the
*query*, so landmark/budget terms in a user query inflate the denominator while
no listing can ever match them.

## Goals

- Extract entities for all listings without consuming online Gemini quota.
- Make graph rebuilds independent of any AI provider being reachable.
- Only re-extract listings whose text actually changed.
- Survive partial failures without destroying existing data.

## Non-goals

- Changing the extraction prompt or the entity taxonomy.
- Changing embeddings, which are already complete (704/704).
- Replacing the inline extraction used by incremental sync.

## Approach

Use Vertex AI **batch prediction** (50% cheaper, no online RPM quota, up to
200,000 requests per job) with Cloud Storage JSONL in and out. Extraction becomes
a cache-fill step persisted in Postgres; graph rebuilds then read SQL only.

### Alternatives rejected

**Chunked requests (50 listings per JSONL line).** Batch mode has no per-minute
request pressure, so chunking buys no throughput. It retains both failure modes
seen in production: a truncated JSON reply loses an entire chunk, and batched
prompts let entities bleed across items.

**BigQuery input/output.** Gives native passthrough columns for ID mapping
instead of embedding the UUID in the prompt, and queryable results. Costs a
dataset, extra IAM, and a new dependency for a 704-row job. Revisit if listing
volume reaches tens of thousands.

**Bigger online batches (176/call, 4 requests).** Prototyped in the working tree
on 2026-07-31 and functional, but still consumes online quota and still has an
output-truncation cliff. Superseded by this design, so implementation reverts the
uncommitted `EXTRACT_BATCH_SIZE = 176` / `EXTRACT_DELAY_MS` / per-batch
`maxOutputTokens` changes in `lib/graph/rebuild.ts` and `lib/vertex/client.ts`.

The AGE cypher apostrophe fix in the same working tree (`\'` escaping plus
strip-instead-of-throw sanitization) is unrelated to extraction and is kept.

## Design

### Storage

New bucket in `us-central1` (must match `GOOGLE_CLOUD_LOCATION`, since the batch
job region and bucket region must agree), granted to the
`gentle-space-vertex-stackgen` service account, with a 7-day object lifecycle
rule so JSONL inputs and outputs do not accumulate cost.

The service account needs object read/write on that bucket plus
`aiplatform.batchPredictionJobs.create` and `.get`.

### Schema (migration `007_entity_extraction_cache.sql`)

```sql
ALTER TABLE listings
  ADD COLUMN extracted_entities JSONB,
  ADD COLUMN entities_hash TEXT;
```

`entities_hash` uses the same formula as the existing `embed_hash`: sha256 over
`buildListingEmbeddingText()` with amenities sorted. The existing `embedHash()` in
`lib/sync/content-hash.ts` takes a sync-time `RawListing`, but submit works from
DB `Listing` rows, so the shared part is factored into an exported
`hashEmbeddingText(fields)` that `embedHash()` then calls. This keeps one formula
rather than two that can drift apart.

The two columns hold the same value but advance independently: `embed_hash`
advances when embeddings are written, `entities_hash` when entities are written.
A listing is stale when `entities_hash IS NULL` or differs from the current hash,
so a submit after a no-op sync sends zero requests.

`extracted_entities` stores the normalized `QueryEntities` shape.

### Modules

**`lib/vertex/batch.ts`** — thin REST wrapper reusing the existing
`getVertexAccessToken()`:

- `putGcsObject()`, `listGcsObjects(prefix)`, `getGcsObject()` via the Cloud
  Storage JSON API. No `@google-cloud/storage` dependency; these are three fetch
  calls against an API we already hold a token for.
- `createBatchPredictionJob()` / `getBatchPredictionJob()` against
  `POST|GET https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/{LOCATION}/batchPredictionJobs`,
  with `model: "publishers/google/models/gemini-2.5-flash-lite"`.

**`scripts/submit-entity-extraction.ts`** (`npm run entities:submit`) — selects
stale listings, builds JSONL, uploads it, creates the job, prints the job name.

**`scripts/apply-entity-extraction.ts`** (`npm run entities:apply <job>`) —
verifies `JOB_STATE_SUCCEEDED`, lists every output object, parses all lines,
writes entities to SQL, then rebuilds the graph.

### Request format

One request per listing, reusing the existing single-item `EXTRACT_SYSTEM` prompt
and `parseExtractedEntitiesJson()` — no new prompt surface:

```json
{"request": {
  "systemInstruction": {"parts": [{"text": "<EXTRACT_SYSTEM + ignore-ID line>"}]},
  "contents": [{"role": "user", "parts": [{"text": "LISTING_ID: <uuid>\n<listing text>"}]}],
  "generationConfig": {"responseMimeType": "application/json", "temperature": 0}
}}
```

### ID mapping

Batch output is written to a **nondeterministic number** of
`prediction.results-N-of-M` objects with **no guaranteed line ordering**, so
position cannot identify a listing. Each output line echoes its input.

The listing UUID is therefore prefixed onto the user text and, on read, parsed
back out of the **echoed request** rather than the model response. This survives
file splitting, reordering, and any model output weirdness. `EXTRACT_SYSTEM`
gains one line telling the model to ignore the `LISTING_ID:` line.

### Rebuild split

- `rebuildListingGraph()` stops calling Gemini. It reads `extracted_entities`
  from SQL, merges with existing seeds (`area`, `city`, `amenities`,
  `propertyType`), and upserts. No AI provider needed, no pacing, no 429 path.
  `GRAPH_SEED_ONLY` and the extract pacing constants are removed.
- `syncListingGraph()` keeps its inline online extract. It only ever handles the
  handful of listings changed by a sync run, where online latency is correct and
  quota cost is trivial.

### Error handling

Partial failure is the expected case, not an exception:

- A line with non-empty `status`, or a response body that will not parse, leaves
  that listing's existing `extracted_entities` **untouched** rather than nulling
  it, and does not advance its `entities_hash` (so the next submit retries it).
- A line whose echoed request has no parseable UUID, or a UUID not in the
  database, is skipped and counted.
- `apply` prints applied / failed / skipped counts and exits non-zero only if
  zero listings were applied.
- A job in any state other than `JOB_STATE_SUCCEEDED` causes `apply` to report
  the state and exit without touching SQL or the graph.

## Testing

Unit tests, no live Vertex calls:

- JSONL builder: UUID prefix present, request shape matches the batch schema, one
  line per stale listing.
- Output parser: multiple result files, out-of-order lines, failed-status lines,
  unparseable body, unknown UUID.
- Staleness selection: an unchanged listing is not submitted.
- Rebuild reads SQL entities and never calls the AI client.

Live verification: a 3-listing job end to end before submitting all 704.

## Cost

~330k input tokens (including the system instruction repeated per request) and
~56k output tokens. At the batch-discounted Gemini 2.5 Flash-Lite rate
($0.05/1M input, $0.20/1M output): **≈ $0.03 per full extraction**. Subsequent
runs cost proportionally less because only changed listings are submitted.
