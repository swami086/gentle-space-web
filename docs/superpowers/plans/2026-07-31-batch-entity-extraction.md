# Batch Entity Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move full-corpus Gemini entity extraction off online `generateContent` onto Vertex AI batch prediction with a Postgres cache, so `graph:rebuild` never calls Gemini and Landmark/BudgetSignal edges can be populated without burning RPM quota.

**Architecture:** One JSONL request per listing goes to a us-central1 GCS bucket; a two-command workflow (`entities:submit` / `entities:apply <job>`) fills `listings.extracted_entities` + `entities_hash`. Full rebuilds read SQL only and merge with existing seeds. Incremental sync keeps its tiny online extract and also writes the same cache columns so rebuild does not wipe fresh sync extract.

**Tech Stack:** TypeScript, vitest (mocked `fetch` + mocked `pg`), Postgres 16 + AGE, Vertex AI Gemini 2.5 Flash-Lite batch prediction, Cloud Storage JSON API (no `@google-cloud/storage` dependency).

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-31-batch-entity-extraction-design.md`.
- New migration is `lib/db/migrations/007_entity_extraction_cache.sql`.
- Bucket must be in `us-central1` (same as `GOOGLE_CLOUD_LOCATION`). Env var: `VERTEX_BATCH_BUCKET` (bucket name only, no `gs://` prefix).
- One JSONL request per listing. Reuse single-item `EXTRACT_SYSTEM` + `parseExtractedEntitiesJson` — do not invent a new batch prompt for the GCS path.
- UUID is prefixed as `LISTING_ID: <uuid>\n` on the user text and recovered from the **echoed request**, never from model output.
- Partial failure leaves existing `extracted_entities` / `entities_hash` untouched for that row.
- Revert uncommitted online-batching changes (`EXTRACT_BATCH_SIZE = 176`, `EXTRACT_DELAY_MS`, per-batch `maxOutputTokens` in `lib/vertex/client.ts`). Keep the AGE apostrophe/`sanitizeCypherLiteral` fix already in the working tree.
- No new npm dependencies.
- Follow existing patterns: parameterized `getPool().query()`, vitest with `vi.mock`, scripts under `scripts/` with `tsx --env-file=.env.local`.
- Run `npx vitest run <paths>` for test steps. Commit after each task.
- Optional escape hatch: `ENTITIES_SUBMIT_LIMIT` caps how many stale listings a submit includes (used for the 3-listing smoke).

## File map

| File | Responsibility |
|------|----------------|
| `lib/db/migrations/007_entity_extraction_cache.sql` | Add `extracted_entities`, `entities_hash` |
| `lib/db/schema.sql` | Fresh-install mirror of 007 |
| `lib/sync/content-hash.ts` | Export `hashEmbeddingText()`; `embedHash()` calls it |
| `lib/graph/extract.ts` | One-line addition to `EXTRACT_SYSTEM` to ignore `LISTING_ID:` |
| `lib/graph/batch-extract.ts` | Pure JSONL request builder + output line parser (no I/O) |
| `lib/vertex/batch.ts` | GCS put/list/get + create/get batchPredictionJob |
| `lib/db/listings.ts` | Entity hash map, entity upsert, entity map for rebuild |
| `lib/graph/rebuild.ts` | SQL-only full rebuild; sync path still extracts online and writes cache |
| `scripts/submit-entity-extraction.ts` | Select stale → upload → create job → print name |
| `scripts/apply-entity-extraction.ts` | Check job → parse results → SQL → graph rebuild |
| `package.json` | `entities:submit`, `entities:apply` |
| `.env.example`, `README.md`, `openmemory.md` | Document bucket + commands |

---

### Task 1: Migration + schema + README

**Files:**
- Create: `lib/db/migrations/007_entity_extraction_cache.sql`
- Modify: `lib/db/schema.sql`
- Modify: `README.md` (migration block after `006_split_embeddings.sql`)

**Interfaces:**
- Produces: columns `listings.extracted_entities JSONB`, `listings.entities_hash TEXT`

- [ ] **Step 1: Write the migration**

Create `lib/db/migrations/007_entity_extraction_cache.sql`:

```sql
BEGIN;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS extracted_entities JSONB,
  ADD COLUMN IF NOT EXISTS entities_hash TEXT;

COMMIT;
```

- [ ] **Step 2: Apply locally and verify**

```bash
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings < lib/db/migrations/007_entity_extraction_cache.sql
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings -c "\d listings" | grep -E 'extracted_entities|entities_hash'
```

Expected: both columns listed (`jsonb` and `text`).

- [ ] **Step 3: Update `lib/db/schema.sql`**

After `embed_hash TEXT,` add:

```sql
  extracted_entities JSONB,
  entities_hash TEXT,
```

- [ ] **Step 4: Document in README**

After the `006_split_embeddings.sql` line in the migration block, add:

```bash
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings < lib/db/migrations/007_entity_extraction_cache.sql
```

- [ ] **Step 5: Commit**

```bash
git add lib/db/migrations/007_entity_extraction_cache.sql lib/db/schema.sql README.md
git commit -m "$(cat <<'EOF'
feat(db): add extracted_entities cache columns for batch graph extract

EOF
)"
```

---

### Task 2: Shared embedding-text hash

**Files:**
- Modify: `lib/sync/content-hash.ts`
- Modify: `lib/sync/content-hash.test.ts`

**Interfaces:**
- Produces: `hashEmbeddingText(fields: Parameters<typeof buildListingEmbeddingText>[0]): string`
- Consumes: `buildListingEmbeddingText` from `lib/listings/embedding-text.ts`
- `embedHash(row)` must keep returning the same digests as before (call `hashEmbeddingText` with sorted amenities)

- [ ] **Step 1: Write the failing test**

Add to `lib/sync/content-hash.test.ts`:

```ts
import { hashEmbeddingText } from "./content-hash";

it("hashEmbeddingText matches embedHash for the same embedding fields", () => {
  const r = row();
  expect(
    hashEmbeddingText({
      title: r.title,
      area: r.area,
      city: r.city,
      propertyType: r.propertyType,
      pricingHint: r.pricingHint,
      shortTeaser: r.shortTeaser,
      description: r.description,
      amenities: ["Coffee", "WiFi"],
    }),
  ).toBe(embedHash(r));
});

it("hashEmbeddingText is stable under amenity reorder", () => {
  const fields = {
    title: "A",
    area: "B",
    city: "Bengaluru",
    propertyType: null,
    pricingHint: null,
    shortTeaser: "",
    description: "d",
    amenities: ["WiFi", "Coffee"],
  };
  expect(hashEmbeddingText(fields)).toBe(
    hashEmbeddingText({ ...fields, amenities: ["Coffee", "WiFi"] }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/sync/content-hash.test.ts
```

Expected: FAIL — `hashEmbeddingText` is not exported.

- [ ] **Step 3: Implement**

In `lib/sync/content-hash.ts`, replace `embedHash` with:

```ts
export function hashEmbeddingText(
  fields: Parameters<typeof buildListingEmbeddingText>[0],
): string {
  return sha256(
    buildListingEmbeddingText({
      ...fields,
      amenities: sortedUnique(fields.amenities),
    }),
  );
}

export function embedHash(row: RawListing): string {
  return hashEmbeddingText(row);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run lib/sync/content-hash.test.ts
```

Expected: PASS (including existing amenity-order / image-only cases).

- [ ] **Step 5: Commit**

```bash
git add lib/sync/content-hash.ts lib/sync/content-hash.test.ts
git commit -m "$(cat <<'EOF'
refactor: share hashEmbeddingText for embed and entity cache hashes

EOF
)"
```

---

### Task 3: Pure batch JSONL builder + parser

**Files:**
- Modify: `lib/graph/extract.ts` (`EXTRACT_SYSTEM` only)
- Create: `lib/graph/batch-extract.ts`
- Create: `lib/graph/batch-extract.test.ts`

**Interfaces:**
- Produces:
  - `buildEntityBatchJsonlLine(listingId: string, listingText: string): string`
  - `buildEntityBatchJsonl(items: { id: string; text: string }[]): string`
  - `parseEntityBatchOutputLine(line: string): { listingId: string | null; entities: QueryEntities | null; failed: boolean }`
  - `parseEntityBatchOutput(files: string[]): { applied: Map<string, QueryEntities>; failed: number; skipped: number }`
- Consumes: `EXTRACT_SYSTEM`, `parseExtractedEntitiesJson`

- [ ] **Step 1: Extend EXTRACT_SYSTEM**

Append this line to `EXTRACT_SYSTEM` in `lib/graph/extract.ts` (keep existing text otherwise):

```
If the text begins with a LISTING_ID: line, ignore that line entirely — it is metadata, not content.
```

Do **not** change `EXTRACT_BATCH_SYSTEM` (online sync batch path is unchanged).

- [ ] **Step 2: Write failing tests**

Create `lib/graph/batch-extract.test.ts` with cases for:
1. `buildEntityBatchJsonlLine` embeds `LISTING_ID: <uuid>\n...`, includes `EXTRACT_SYSTEM` (which mentions LISTING_ID), and sets `generationConfig: { responseMimeType: "application/json", temperature: 0 }`.
2. `parseEntityBatchOutputLine` recovers UUID from echoed `request.contents[0].parts[0].text` and parses landmarks (expect normalized lowercase).
3. Non-empty `status` → `failed: true`, `entities: null`.
4. Missing UUID → `listingId: null`, counted as skipped by the multi-file parser.
5. `parseEntityBatchOutput` merges multiple files / out-of-order lines and increments `skipped` for malformed lines.

Use listing id `550e8400-e29b-41d4-a716-446655440000` in fixtures. Output line shape:

```json
{
  "status": "",
  "request": { "contents": [{ "parts": [{ "text": "LISTING_ID: <uuid>\nhello" }] }] },
  "response": { "candidates": [{ "content": { "parts": [{ "text": "{\"areas\":[],\"amenities\":[],\"deskTypes\":[],\"landmarks\":[\"Indiranagar Metro\"],\"budgetSignals\":[]}" }] } }] }
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run lib/graph/batch-extract.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 4: Implement `lib/graph/batch-extract.ts`**

```ts
import { EXTRACT_SYSTEM, parseExtractedEntitiesJson } from "./extract";
import type { QueryEntities } from "./types";

const LISTING_ID_RE =
  /^LISTING_ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

export function buildEntityBatchJsonlLine(listingId: string, listingText: string): string {
  return JSON.stringify({
    request: {
      systemInstruction: { parts: [{ text: EXTRACT_SYSTEM }] },
      contents: [
        {
          role: "user",
          parts: [{ text: `LISTING_ID: ${listingId}\n${listingText}` }],
        },
      ],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    },
  });
}

export function buildEntityBatchJsonl(items: { id: string; text: string }[]): string {
  if (items.length === 0) return "";
  return items.map((item) => buildEntityBatchJsonlLine(item.id, item.text)).join("\n") + "\n";
}

function extractListingIdFromRequest(request: unknown): string | null {
  if (!request || typeof request !== "object") return null;
  const contents = (request as { contents?: unknown }).contents;
  if (!Array.isArray(contents) || contents.length === 0) return null;
  const parts = (contents[0] as { parts?: unknown }).parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const text = (parts[0] as { text?: unknown }).text;
  if (typeof text !== "string") return null;
  const match = LISTING_ID_RE.exec(text);
  return match?.[1]?.toLowerCase() ?? null;
}

function responseText(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const candidates = (response as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = (candidates[0] as { content?: { parts?: unknown } }).content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const text = (parts[0] as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}

export function parseEntityBatchOutputLine(line: string): {
  listingId: string | null;
  entities: QueryEntities | null;
  failed: boolean;
} {
  const trimmed = line.trim();
  if (!trimmed) return { listingId: null, entities: null, failed: false };
  let row: { status?: unknown; request?: unknown; response?: unknown };
  try {
    row = JSON.parse(trimmed) as typeof row;
  } catch {
    return { listingId: null, entities: null, failed: false };
  }
  const listingId = extractListingIdFromRequest(row.request);
  const status = typeof row.status === "string" ? row.status.trim() : "";
  if (status) return { listingId, entities: null, failed: Boolean(listingId) };
  const text = responseText(row.response);
  if (!text) return { listingId, entities: null, failed: Boolean(listingId) };
  return { listingId, entities: parseExtractedEntitiesJson(text), failed: false };
}

export function parseEntityBatchOutput(files: string[]): {
  applied: Map<string, QueryEntities>;
  failed: number;
  skipped: number;
} {
  const applied = new Map<string, QueryEntities>();
  let failed = 0;
  let skipped = 0;
  for (const file of files) {
    for (const line of file.split("\n")) {
      if (!line.trim()) continue;
      const parsed = parseEntityBatchOutputLine(line);
      if (!parsed.listingId) {
        skipped += 1;
        continue;
      }
      if (parsed.failed || !parsed.entities) {
        failed += 1;
        continue;
      }
      applied.set(parsed.listingId, parsed.entities);
    }
  }
  return { applied, failed, skipped };
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run lib/graph/batch-extract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/graph/extract.ts lib/graph/batch-extract.ts lib/graph/batch-extract.test.ts
git commit -m "$(cat <<'EOF'
feat(graph): add pure Vertex batch JSONL builder and output parser

EOF
)"
```

---

### Task 4: DB helpers for entity cache

**Files:**
- Modify: `lib/db/listings.ts`
- Create: `lib/db/listings-entities.test.ts`

**Interfaces:**
- Produces:
  - `listListingEntityHashes(): Promise<Map<string, string | null>>`
  - `updateListingExtractedEntities(id: string, entities: QueryEntities, entitiesHash: string): Promise<void>`
  - `listListingExtractedEntities(): Promise<Map<string, QueryEntities>>`
- Callers pass the hash; helpers only store/load JSONB. Staleness filtering happens in submit.

- [ ] **Step 1: Write failing tests**

Mock `./client` `getPool().query` like other listings tests. Cover:
1. `listListingEntityHashes` SQL mentions `entities_hash` and `missing_runs`.
2. `updateListingExtractedEntities` sends `[JSON.stringify(entities), hash, id]`.
3. `listListingExtractedEntities` maps only non-null rows through `parseExtractedEntities` (areas lowercased).

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run lib/db/listings-entities.test.ts
```

- [ ] **Step 3: Implement in `lib/db/listings.ts`**

```ts
import { parseExtractedEntities } from "../graph/extract";
import type { QueryEntities } from "../graph/types";

export async function listListingEntityHashes(): Promise<Map<string, string | null>> {
  if (!process.env.DATABASE_URL) return new Map();
  const visibleLimit = getListingMissingRunsLimit();
  const { rows } = await getPool().query<{ id: string; entities_hash: string | null }>(
    `SELECT id, entities_hash FROM listings WHERE missing_runs < $1`,
    [visibleLimit],
  );
  return new Map(rows.map((row) => [row.id, row.entities_hash]));
}

export async function updateListingExtractedEntities(
  id: string,
  entities: QueryEntities,
  entitiesHash: string,
): Promise<void> {
  await getPool().query(
    `UPDATE listings
     SET extracted_entities = $1::jsonb, entities_hash = $2
     WHERE id = $3`,
    [JSON.stringify(entities), entitiesHash, id],
  );
}

export async function listListingExtractedEntities(): Promise<Map<string, QueryEntities>> {
  if (!process.env.DATABASE_URL) return new Map();
  const visibleLimit = getListingMissingRunsLimit();
  const { rows } = await getPool().query<{ id: string; extracted_entities: unknown }>(
    `SELECT id, extracted_entities FROM listings
     WHERE missing_runs < $1 AND extracted_entities IS NOT NULL`,
    [visibleLimit],
  );
  return new Map(rows.map((row) => [row.id, parseExtractedEntities(row.extracted_entities)]));
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run lib/db/listings-entities.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/db/listings.ts lib/db/listings-entities.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add extracted_entities read/write helpers

EOF
)"
```

---

### Task 5: Vertex batch + GCS REST client

**Files:**
- Create: `lib/vertex/batch.ts`
- Create: `lib/vertex/batch.test.ts`

**Interfaces:**
- Produces:
  - `putGcsObject(bucket: string, object: string, body: string, contentType?: string): Promise<void>`
  - `listGcsObjects(bucket: string, prefix: string): Promise<string[]>`
  - `getGcsObject(bucket: string, object: string): Promise<string>`
  - `createBatchPredictionJob(input: { displayName: string; inputUri: string; outputUriPrefix: string }): Promise<{ name: string }>`
  - `getBatchPredictionJob(name: string): Promise<{ name: string; state: string; outputInfo?: { gcsOutputDirectory?: string } }>`
- Consumes: `getVertexAccessToken()` from `./auth`
- Env: `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` (default `us-central1`), `VERTEX_CHAT_MODEL` (default `gemini-2.5-flash-lite`)

- [ ] **Step 1: Write failing tests with mocked `fetch`**

Cover upload URL containing `upload/storage/v1/b/{bucket}/o`, list returning object names, download returning text, create/get job round-trip with `JOB_STATE_SUCCEEDED` and `outputInfo.gcsOutputDirectory`.

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run lib/vertex/batch.test.ts
```

- [ ] **Step 3: Implement `lib/vertex/batch.ts`**

Endpoints:
- Upload: `POST https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o?uploadType=media&name={encodeURIComponent(object)}`
- List: `GET https://storage.googleapis.com/storage/v1/b/{bucket}/o?prefix={encodeURIComponent(prefix)}`
- Download: `GET https://storage.googleapis.com/storage/v1/b/{bucket}/o/{encodeURIComponent(object)}?alt=media`
- Create job: `POST https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/batchPredictionJobs`

Create body:

```json
{
  "displayName": "...",
  "model": "projects/{project}/locations/{location}/publishers/google/models/{model}",
  "inputConfig": {
    "instancesFormat": "jsonl",
    "gcsSource": { "uris": ["gs://bucket/in.jsonl"] }
  },
  "outputConfig": {
    "predictionsFormat": "jsonl",
    "gcsDestination": { "outputUriPrefix": "gs://bucket/out/" }
  }
}
```

Get job: `GET https://{location}-aiplatform.googleapis.com/v1/{name}` (full resource path).

Throw `Error` with status + body text on non-OK.

- [ ] **Step 4: Run tests**

```bash
npx vitest run lib/vertex/batch.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/vertex/batch.ts lib/vertex/batch.test.ts
git commit -m "$(cat <<'EOF'
feat(vertex): add GCS + batchPredictionJobs REST helpers

EOF
)"
```

---

### Task 6: `entities:submit` script

**Files:**
- Create: `scripts/submit-entity-extraction.ts`
- Modify: `package.json` — add `"entities:submit": "tsx --env-file=.env.local scripts/submit-entity-extraction.ts"`
- Modify: `.env.example` — document `VERTEX_BATCH_BUCKET=` and optional `ENTITIES_SUBMIT_LIMIT=`

**Interfaces:**
- Consumes: `listListings`, `listListingEntityHashes`, `hashEmbeddingText`, `buildListingEmbeddingText`, `buildEntityBatchJsonl`, `putGcsObject`, `createBatchPredictionJob`
- Prints full job resource name; exits 0 if zero stale listings.

- [ ] **Step 1: Implement the script**

Logic:
1. Require `VERTEX_BATCH_BUCKET`.
2. `stale = listings.filter(l => listListingEntityHashes.get(l.id) !== hashEmbeddingText(l))`.
3. Honor `ENTITIES_SUBMIT_LIMIT` if a positive number.
4. Upload `entity-extract/{iso-stamp}/input.jsonl`.
5. Create job with `outputUriPrefix = gs://{bucket}/entity-extract/{stamp}/out/`.
6. `console.log` count + `job.name`.

- [ ] **Step 2: Wire package.json + .env.example**

- [ ] **Step 3: Commit**

```bash
git add scripts/submit-entity-extraction.ts package.json .env.example
git commit -m "$(cat <<'EOF'
feat: add entities:submit for Vertex batch entity extraction

EOF
)"
```

---

### Task 7: `entities:apply` script

**Files:**
- Create: `scripts/apply-entity-extraction.ts`
- Modify: `package.json` — add `"entities:apply": "tsx --env-file=.env.local scripts/apply-entity-extraction.ts"`

**Interfaces:**
- CLI: `npm run entities:apply -- <job-resource-name>`
- Consumes: `getBatchPredictionJob`, `listGcsObjects`, `getGcsObject`, `parseEntityBatchOutput`, `listListings`, `updateListingExtractedEntities`, `hashEmbeddingText`, `rebuildListingGraph`
- Exits non-zero if job not `JOB_STATE_SUCCEEDED`, or if zero rows written.

- [ ] **Step 1: Implement**

Logic:
1. `getBatchPredictionJob`; refuse unless `JOB_STATE_SUCCEEDED`.
2. Read `outputInfo.gcsOutputDirectory` (`gs://bucket/prefix`).
3. List objects under prefix; keep names containing `prediction.results-`.
4. Download all, `parseEntityBatchOutput`.
5. For each applied id present in `listListings()`, `updateListingExtractedEntities(id, entities, hashEmbeddingText(listing))`.
6. Log `{ wrote, failed, skipped, unknown, resultFiles }`.
7. If `wrote === 0`, exit 1.
8. Call `rebuildListingGraph()` and log result.

- [ ] **Step 2: Commit**

```bash
git add scripts/apply-entity-extraction.ts package.json
git commit -m "$(cat <<'EOF'
feat: add entities:apply to load batch results and rebuild graph

EOF
)"
```

---

### Task 8: SQL-only rebuild + sync cache write + revert online batching

**Files:**
- Modify: `lib/graph/rebuild.ts`
- Modify: `lib/vertex/client.ts` (remove per-batch `maxOutputTokens`; leave 429 retry)
- Create: `lib/graph/rebuild.test.ts`

**Interfaces:**
- `rebuildListingGraph()` never calls Gemini. Gate on `DATABASE_URL` + `isAgeAvailable()` only.
- `extracted_entities` stores **LLM output only** (not seeds). Rebuild always re-seeds and merges.
- `syncListingGraph()` still extracts online (`forEachChunkPaced` with `EXTRACT_BATCH_SIZE = 50`, `ITEMS_PER_MINUTE = 25`), writes pre-merge extracted entities via `updateListingExtractedEntities`, then `replaceListingGraphs`.
- Remove `GRAPH_SEED_ONLY`, `EXTRACT_BATCH_SIZE = 176`, `EXTRACT_DELAY_MS`, and the custom sleep loop from rebuild.

- [ ] **Step 1: Write failing rebuild test**

Mock AI client + DB. Assert `rebuildListingGraph()` does not call `extractSearchEntitiesBatchStrict`, and merges cached landmarks onto seeded areas.

- [ ] **Step 2: Implement rebuild split; revert `maxOutputTokens` in `lib/vertex/client.ts`**

Restore online batch `generationConfig` to:

```ts
generationConfig: { responseMimeType: "application/json", temperature: 0 },
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run lib/graph lib/db/listings-entities.test.ts lib/vertex/batch.test.ts
```

- [ ] **Step 4: Commit**

Include the already-working AGE apostrophe fix files if still uncommitted (`lib/graph/age.ts`, `lib/graph/age.test.ts`) in this commit or an immediately prior one — they are required for apply→rebuild to succeed on titles with `'`.

```bash
git add lib/graph/rebuild.ts lib/graph/rebuild.test.ts lib/vertex/client.ts lib/graph/age.ts lib/graph/age.test.ts
git commit -m "$(cat <<'EOF'
feat(graph): rebuild from SQL entity cache; keep online extract for sync only

EOF
)"
```

---

### Task 9: Docs + openmemory

**Files:**
- Modify: `openmemory.md`
- Modify: `README.md`

- [ ] **Step 1: Document workflow**

```bash
export VERTEX_BATCH_BUCKET=gentle-space-entity-batch-us-central1
npm run entities:submit
npm run entities:apply -- projects/.../batchPredictionJobs/...
```

Note that `apply` already rebuilds the graph; `graph:rebuild` is SQL-only afterward.

- [ ] **Step 2: Commit**

```bash
git add openmemory.md README.md
git commit -m "$(cat <<'EOF'
docs: document batch entity extraction workflow

EOF
)"
```

---

### Task 10: GCS bucket + IAM (ops, run once)

Not a code change — execute against project `propane-galaxy-498403-n8`.

- [ ] **Step 1: Create bucket with 7-day lifecycle**

```bash
gcloud storage buckets create gs://gentle-space-entity-batch-us-central1 \
  --project=propane-galaxy-498403-n8 \
  --location=us-central1 \
  --uniform-bucket-level-access
```

Write `/tmp/entity-batch-lifecycle.json` with a Delete rule at age 7, then:

```bash
gcloud storage buckets update gs://gentle-space-entity-batch-us-central1 \
  --lifecycle-file=/tmp/entity-batch-lifecycle.json
```

- [ ] **Step 2: Grant the Vertex SA `roles/storage.objectAdmin` on the bucket**

Read `client_email` from `.secrets/gentle-space-vertex-stackgen.json` and bind that member. Confirm the SA already has `roles/aiplatform.user` on the project (online generateContent already works).

- [ ] **Step 3: Set env**

Add `VERTEX_BATCH_BUCKET=gentle-space-entity-batch-us-central1` to local `.env.local` and VM `deploy/.env.production`.

---

### Task 11: Live smoke then full extract

- [ ] **Step 1: 3-listing smoke**

```bash
ENTITIES_SUBMIT_LIMIT=3 npm run entities:submit
```

Poll until `JOB_STATE_SUCCEEDED`, then `npm run entities:apply -- <job>`.

Verify `extracted_entities IS NOT NULL` for those rows and Landmark and/or BudgetSignal nodes appear in AGE.

- [ ] **Step 2: Full corpus**

```bash
npm run entities:submit
npm run entities:apply -- <job>
```

Verify search still returns HTTP 200 with listings.

- [ ] **Step 3: Deploy to VM**

Sync commits, rebuild the web image, apply migration `007` on `gentle-space-pg`, set `VERTEX_BATCH_BUCKET`, then run submit/apply there if local was only a dry run.

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Dedicated us-central1 bucket + 7-day lifecycle + SA grant | Task 10 |
| Migration `007` `extracted_entities` + `entities_hash` | Task 1 |
| `hashEmbeddingText` shared with `embedHash` | Task 2 |
| One request/listing, `EXTRACT_SYSTEM`, UUID prefix | Task 3 |
| Pure parser: multi-file, reorder, failed status, bad UUID | Task 3 |
| GCS + batchPredictionJobs REST, no new deps | Task 5 |
| `entities:submit` / `entities:apply` two-command flow | Tasks 6–7 |
| Rebuild SQL-only; sync keeps online extract + writes cache | Task 8 |
| Partial failure leaves row untouched | Tasks 3, 7 |
| Revert 176-batch online experiment; keep AGE apostrophe fix | Task 8 |
| Docs | Task 9 |
| Live 3-listing then full 704 | Task 11 |

No TBD/placeholder steps. `extracted_entities` is LLM-only; rebuild re-seeds every time.
