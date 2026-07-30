# Fine-Grained Listing Embeddings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split each listing's single combined embedding into two purpose-built vectors (`structured_embedding`, `description_embedding`) so AI search on `/spaces` stops averaging categorical facts and free-text nuance into one blended vector, combining them at query time with `GREATEST(...)`.

**Architecture:** Two new pgvector columns replace `listings.embedding`. `lib/sync/embed-listings.ts` embeds both texts per listing in one interleaved Vertex `embedTexts()` call (16 listings × 2 texts = 32 texts/call, same batch size as today). `searchListingsByEmbedding()` takes the higher cosine similarity of the two columns per row. Entity extraction and the search route's query-embedding call are untouched.

**Tech Stack:** Next.js 15 App Router, TypeScript, vitest (mocked `pg` pool + mocked `fetch`/AI clients), Postgres 16 + pgvector (`gentle-space-pg` local Docker container), Vertex AI `text-embedding-004`.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-30-fine-grained-embeddings-design.md`.
- New migration is `lib/db/migrations/006_split_embeddings.sql` (next number after the existing `002`–`005`).
- Data model: `structured_embedding vector(768)` built from `title · area · city · propertyType · pricingHint · amenities`; `description_embedding vector(768)` built from `shortTeaser · description`. Both replace the single `embedding vector(768)` column — no listing keeps the old column.
- Query-time combination: `GREATEST(1 - (structured_embedding <=> $1::vector), 1 - (description_embedding <=> $1::vector))` — take the max, never average.
- Sync/backfill batch size stays at 32 texts per Vertex `embedTexts()` call (`LISTINGS_PER_CHUNK = 16` listings × 2 texts). This roughly doubles Vertex call frequency (~0.9 → ~1.9 calls/min at the existing 30-listings/min pace), which stays well under the 5 requests/min default quota for `text-embedding-004` — no quota increase needed.
- Reuse `forEachChunkPaced` from `lib/sync/pace.ts` unchanged (30 items/min pacing target is unchanged; only the chunk size fed into it changes).
- No changes to: entity extraction (`lib/graph/*`, `extractSearchEntitiesBatch`), `/api/spaces/insight`, the search route's query-embedding call, or `lib/sync/pace.ts` itself.
- `listListingsMissingEmbedding()` treats a listing as needing embedding if **either** column is `NULL` — this makes the one-time backfill automatic via the normal sync/embed pass, no separate backfill script.
- Follow existing repo patterns: `lib/db/listings.ts` query style (parameterized, `getPool().query()`), vitest with `vi.mock` on `./client`/`../db/listings`/`../ai/client`, no `describe` nesting in files that don't already use it (e.g. `lib/sync/embed-listings.test.ts`).
- Run `npm test` (vitest) for all test steps. Commit after each task.
- Per the user's explicit instruction, verify locally against the local Docker Postgres (`gentle-space-pg`, `gentle_space_listings` DB) before any GCP deployment. GCP rollout is a manual follow-up after this plan, not part of it.

---

### Task 1: Split-embedding migration and schema

Adds the two new pgvector columns and indexes, drops the old single column, and updates the fresh-install schema and README migration instructions.

**Files:**
- Create: `lib/db/migrations/006_split_embeddings.sql`
- Modify: `lib/db/schema.sql:1-32`
- Modify: `README.md:13-22`

**Interfaces:**
- Produces: columns `listings.structured_embedding vector(768)`, `listings.description_embedding vector(768)`; indexes `listings_structured_embedding_ivfflat`, `listings_description_embedding_ivfflat`. The old `listings.embedding` column and `listings_embedding_ivfflat` index no longer exist after this task.

- [ ] **Step 1: Write the migration**

Create `lib/db/migrations/006_split_embeddings.sql`:

```sql
BEGIN;

DROP INDEX IF EXISTS listings_embedding_ivfflat;
ALTER TABLE listings DROP COLUMN IF EXISTS embedding;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS structured_embedding vector(768);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS description_embedding vector(768);

CREATE INDEX IF NOT EXISTS listings_structured_embedding_ivfflat
  ON listings USING ivfflat (structured_embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS listings_description_embedding_ivfflat
  ON listings USING ivfflat (description_embedding vector_cosine_ops)
  WITH (lists = 100);

COMMIT;
```

- [ ] **Step 2: Apply the migration to the local Docker Postgres and verify**

Run:

```bash
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings < lib/db/migrations/006_split_embeddings.sql
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings -c '\d listings'
```

Expected: the `\d listings` output lists `structured_embedding` and `description_embedding` as `vector(768)`, and does **not** list `embedding`.

- [ ] **Step 3: Update the fresh-install schema**

In `lib/db/schema.sql`, replace:

```sql
  content_hash TEXT,
  embed_hash TEXT,
  embedding vector(768),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS listings_embedding_ivfflat
  ON listings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

with:

```sql
  content_hash TEXT,
  embed_hash TEXT,
  structured_embedding vector(768),
  description_embedding vector(768),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS listings_structured_embedding_ivfflat
  ON listings USING ivfflat (structured_embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS listings_description_embedding_ivfflat
  ON listings USING ivfflat (description_embedding vector_cosine_ops)
  WITH (lists = 100);
```

- [ ] **Step 4: Document the migration command in README**

In `README.md`, after the line applying `005_incremental_sync.sql` (in the fenced block under "Apply schema and the pgvector/AGE migrations"), add:

```bash
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings < lib/db/migrations/006_split_embeddings.sql
```

- [ ] **Step 5: Commit**

```bash
git add lib/db/migrations/006_split_embeddings.sql lib/db/schema.sql README.md
git commit -m "feat(db): split listing embedding into structured + description columns"
```

---

### Task 2: Structured and description embedding text builders

Pure text builders mirroring the existing `buildListingEmbeddingText()`, refactored to share a join helper (DRY) without changing that function's existing behavior/tests.

**Files:**
- Modify: `lib/listings/embedding-text.ts`
- Test: `lib/listings/embedding-text.test.ts`

**Interfaces:**
- Produces: `buildStructuredEmbeddingText(l: { title; area; city; propertyType; pricingHint; amenities }): string`, `buildDescriptionEmbeddingText(l: { shortTeaser; description }): string`. `buildListingEmbeddingText()` keeps its existing signature and behavior unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `lib/listings/embedding-text.test.ts`:

```ts
import { buildDescriptionEmbeddingText, buildStructuredEmbeddingText } from "./embedding-text";

describe("buildStructuredEmbeddingText", () => {
  it("joins only categorical fields", () => {
    const text = buildStructuredEmbeddingText({
      title: "WeWork Koramangala",
      area: "Koramangala",
      city: "Bengaluru",
      propertyType: "Private cabin",
      pricingHint: "From ₹12,000",
      amenities: ["WiFi", "AC"],
    });
    expect(text).toBe(
      "WeWork Koramangala · Koramangala · Bengaluru · Private cabin · From ₹12,000 · WiFi, AC",
    );
  });

  it("skips empty amenities and null fields", () => {
    const text = buildStructuredEmbeddingText({
      title: "X",
      area: "",
      city: "",
      propertyType: null,
      pricingHint: null,
      amenities: [],
    });
    expect(text).toBe("X");
  });
});

describe("buildDescriptionEmbeddingText", () => {
  it("joins short teaser and description", () => {
    const text = buildDescriptionEmbeddingText({
      shortTeaser: "Near metro",
      description: "Quiet floors with 24/7 access",
    });
    expect(text).toBe("Near metro · Quiet floors with 24/7 access");
  });

  it("returns empty string when both fields are empty", () => {
    expect(buildDescriptionEmbeddingText({ shortTeaser: "", description: "" })).toBe("");
  });
});
```

Update the import at the top of the file from:

```ts
import { buildListingEmbeddingText } from "./embedding-text";
```

to:

```ts
import {
  buildDescriptionEmbeddingText,
  buildListingEmbeddingText,
  buildStructuredEmbeddingText,
} from "./embedding-text";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/listings/embedding-text.test.ts`
Expected: FAIL — `buildStructuredEmbeddingText` and `buildDescriptionEmbeddingText` are not exported.

- [ ] **Step 3: Implement the builders (with a shared join helper)**

Replace the entire contents of `lib/listings/embedding-text.ts` with:

```ts
type EmbeddingFields = {
  title: string;
  area: string;
  city: string;
  propertyType: string | null;
  pricingHint: string | null;
  shortTeaser: string;
  description: string;
  amenities: string[];
};

function joinTextParts(parts: (string | null)[]): string {
  return parts
    .map((p) => (typeof p === "string" ? p.trim() : p))
    .filter((p): p is string => Boolean(p))
    .join(" · ");
}

export function buildListingEmbeddingText(l: EmbeddingFields): string {
  return joinTextParts([
    l.title,
    l.area,
    l.city,
    l.propertyType,
    l.pricingHint,
    l.shortTeaser,
    l.description,
    l.amenities.length ? l.amenities.join(", ") : null,
  ]);
}

export function buildStructuredEmbeddingText(
  l: Pick<EmbeddingFields, "title" | "area" | "city" | "propertyType" | "pricingHint" | "amenities">,
): string {
  return joinTextParts([
    l.title,
    l.area,
    l.city,
    l.propertyType,
    l.pricingHint,
    l.amenities.length ? l.amenities.join(", ") : null,
  ]);
}

export function buildDescriptionEmbeddingText(
  l: Pick<EmbeddingFields, "shortTeaser" | "description">,
): string {
  return joinTextParts([l.shortTeaser, l.description]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/listings/embedding-text.test.ts`
Expected: PASS — 6 tests (2 existing + 4 new), including the existing `buildListingEmbeddingText` tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/listings/embedding-text.ts lib/listings/embedding-text.test.ts
git commit -m "feat(embeddings): add structured and description text builders"
```

---

### Task 3: DB layer — dual-column read/write and GREATEST search query

Updates `lib/db/listings.ts` to write both columns, search across both with `GREATEST`, and treat either-column-null as needing embedding. Also fixes the `applySourceSync()` upsert, which directly references the dropped `embedding` column in its `ON CONFLICT` `CASE` clause.

**Files:**
- Modify: `lib/db/listings.ts:166-204` (`searchListingsByEmbedding`, `updateListingEmbedding`), `lib/db/listings.ts:311-315` (the `embedding = CASE ...` clause inside `applySourceSync`), `lib/db/listings.ts:363-374` (`listListingsMissingEmbedding`)
- Test: `lib/db/listings-search.test.ts`
- Test: `lib/db/listings-sync.test.ts`

**Interfaces:**
- Consumes: `buildStructuredEmbeddingText`, `buildDescriptionEmbeddingText` (Task 2) — used by Task 4, not here.
- Produces: `updateListingEmbeddings(id: string, embeddings: { structured: number[]; description: number[] }): Promise<void>` (replaces `updateListingEmbedding`). `searchListingsByEmbedding()` and `listListingsMissingEmbedding()` keep their existing signatures.

- [ ] **Step 1: Update the search/update tests to expect the dual-column shape**

Replace the entire contents of `lib/db/listings-search.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("./client", () => ({
  getPool: () => ({ query }),
}));

import {
  getListingBySlug,
  listListings,
  listListingsMissingEmbedding,
  searchListingsByEmbedding,
  updateListingEmbeddings,
} from "./listings";

const sampleRow = {
  id: "abc",
  source: "coworker" as const,
  source_id: "c1",
  slug: "wework-prestige",
  title: "WeWork Prestige",
  description: "A space",
  short_teaser: "A space",
  address: "Koramangala",
  area: "Koramangala",
  city: "Bengaluru",
  lat: 12.93,
  lng: 77.62,
  amenities: ["WiFi"],
  images: ["https://example.com/img.jpg"],
  pricing_hint: "₹5000",
  property_type: "Coworking",
  source_url: "https://example.com/wework",
  synced_at: new Date("2026-01-01T00:00:00Z"),
  missing_runs: 0,
  structured_embedding: "[0.1,0.2,0.3]",
  description_embedding: "[0.4,0.5,0.6]",
};

beforeEach(() => {
  query.mockReset();
  delete process.env.DATABASE_URL;
});

describe("searchListingsByEmbedding", () => {
  it("returns [] when DATABASE_URL is unset", async () => {
    const results = await searchListingsByEmbedding([0.1, 0.2, 0.3]);
    expect(results).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("queries the max of both column similarities and maps rows", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValue({
      rows: [{ ...sampleRow, vector_similarity: 0.83 }],
    });

    const results = await searchListingsByEmbedding([0.1, 0.2, 0.3], 5);

    const sql = query.mock.calls[0]?.[0] as string;
    expect(query).toHaveBeenCalledWith(sql, ["[0.1,0.2,0.3]", 3, 20]);
    expect(sql).toContain("GREATEST(");
    expect(sql).toContain("structured_embedding <=> $1::vector");
    expect(sql).toContain("description_embedding <=> $1::vector");
    expect(sql).toContain("AS vector_similarity");
    expect(sql).toContain(
      "WHERE (structured_embedding IS NOT NULL OR description_embedding IS NOT NULL)",
    );
    expect(sql).toContain("missing_runs < $2");
    expect(sql).toContain("ORDER BY vector_similarity DESC");
    expect(results).toHaveLength(1);
    expect(results[0].listing.slug).toBe("wework-prestige");
    expect(results[0].vectorSimilarity).toBe(0.83);
    expect(results[0].listing).not.toHaveProperty("structured_embedding");
    expect(results[0].listing).not.toHaveProperty("description_embedding");
  });
});

describe("visibility-filtered reads", () => {
  it("keeps listListings scoped to visible rows", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValue({ rows: [sampleRow] });

    const results = await listListings();

    expect(query.mock.calls[0]?.[0]).toContain("missing_runs < $1");
    expect(results).toHaveLength(1);
    expect(results[0]?.slug).toBe("wework-prestige");
  });

  it("keeps getListingBySlug scoped to visible rows", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValue({ rows: [sampleRow] });

    const result = await getListingBySlug("wework-prestige");

    expect(query.mock.calls[0]?.[0]).toContain("missing_runs < $2");
    expect(result?.slug).toBe("wework-prestige");
  });
});

describe("listListingsMissingEmbedding", () => {
  it("selects rows where either embedding column is null", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValue({ rows: [sampleRow] });

    const results = await listListingsMissingEmbedding();

    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("structured_embedding IS NULL OR description_embedding IS NULL");
    expect(sql).toContain("missing_runs < $1");
    expect(results).toHaveLength(1);
  });
});

describe("updateListingEmbeddings", () => {
  it("updates both embedding columns via vector cast", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValue({ rows: [] });

    await updateListingEmbeddings("abc", {
      structured: [0.4, 0.5, 0.6],
      description: [0.7, 0.8, 0.9],
    });

    const sql = query.mock.calls[0]?.[0] as string;
    expect(query).toHaveBeenCalledWith(sql, ["[0.4,0.5,0.6]", "[0.7,0.8,0.9]", "abc"]);
    expect(sql).toContain("structured_embedding = $1::vector");
    expect(sql).toContain("description_embedding = $2::vector");
  });
});
```

- [ ] **Step 2: Update the sync test's CASE-clause assertion**

In `lib/db/listings-sync.test.ts`, replace:

```ts
  expect(query.mock.calls[1][0]).toContain("THEN NULL ELSE listings.embedding");
```

with:

```ts
  expect(query.mock.calls[1][0]).toContain("THEN NULL ELSE listings.structured_embedding");
  expect(query.mock.calls[1][0]).toContain("THEN NULL ELSE listings.description_embedding");
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `npx vitest run lib/db/listings-search.test.ts lib/db/listings-sync.test.ts`
Expected: FAIL — `updateListingEmbeddings` is not exported, and the sync test's new assertions don't match the current single-column `CASE` clause.

- [ ] **Step 4: Update `searchListingsByEmbedding` and `updateListingEmbedding`**

In `lib/db/listings.ts`, replace the `searchListingsByEmbedding` and `updateListingEmbedding` functions:

```ts
export async function searchListingsByEmbedding(
  embedding: number[],
  k = 20,
): Promise<ScoredListing[]> {
  if (!process.env.DATABASE_URL) return [];
  const vectorLiteral = `[${embedding.join(",")}]`;
  const visibleLimit = getListingMissingRunsLimit();
  const { rows } = await getPool().query<ListingRow & { vector_similarity: number }>(
    `SELECT *, GREATEST(
       1 - (structured_embedding <=> $1::vector),
       1 - (description_embedding <=> $1::vector)
     )::float8 AS vector_similarity
     FROM listings
     WHERE (structured_embedding IS NOT NULL OR description_embedding IS NOT NULL)
       AND missing_runs < $2
     ORDER BY vector_similarity DESC
     LIMIT $3`,
    [vectorLiteral, visibleLimit, k * 4],
  );
  const scored = rows.map((row) => ({
    listing: rowToListing(row),
    vectorSimilarity: row.vector_similarity,
  }));
  const scoresById = new Map(scored.map((row) => [row.listing.id, row.vectorSimilarity]));

  return dedupeListings(scored.map((row) => row.listing))
    .slice(0, k)
    .map((listing) => ({
      listing,
      vectorSimilarity: scoresById.get(listing.id) ?? 0,
    }));
}

export async function updateListingEmbeddings(
  id: string,
  embeddings: { structured: number[]; description: number[] },
): Promise<void> {
  const structuredLiteral = `[${embeddings.structured.join(",")}]`;
  const descriptionLiteral = `[${embeddings.description.join(",")}]`;
  await getPool().query(
    `UPDATE listings
     SET structured_embedding = $1::vector, description_embedding = $2::vector
     WHERE id = $3`,
    [structuredLiteral, descriptionLiteral, id],
  );
}
```

Note: `ORDER BY vector_similarity DESC` replaces the old ANN-index-friendly `ORDER BY embedding <=> $1::vector` — `GREATEST(...)` over two columns can't use either IVFFlat index, so this is a sequential scan. This is an accepted, documented tradeoff at current catalog scale (see the `ponytail:` comment in the design doc); no code change needed to acknowledge it here beyond this note.

- [ ] **Step 5: Fix the `applySourceSync` upsert's embedding-reset clause**

In `lib/db/listings.ts`, inside `applySourceSync`, replace:

```ts
           missing_runs = 0,
           content_hash = EXCLUDED.content_hash,
           embed_hash = EXCLUDED.embed_hash,
           embedding = CASE
             WHEN listings.embed_hash IS DISTINCT FROM EXCLUDED.embed_hash
               THEN NULL ELSE listings.embedding
           END
         RETURNING id, slug`,
```

with:

```ts
           missing_runs = 0,
           content_hash = EXCLUDED.content_hash,
           embed_hash = EXCLUDED.embed_hash,
           structured_embedding = CASE
             WHEN listings.embed_hash IS DISTINCT FROM EXCLUDED.embed_hash
               THEN NULL ELSE listings.structured_embedding
           END,
           description_embedding = CASE
             WHEN listings.embed_hash IS DISTINCT FROM EXCLUDED.embed_hash
               THEN NULL ELSE listings.description_embedding
           END
         RETURNING id, slug`,
```

- [ ] **Step 6: Update `listListingsMissingEmbedding`**

In `lib/db/listings.ts`, replace:

```ts
export async function listListingsMissingEmbedding(): Promise<Listing[]> {
  if (!process.env.DATABASE_URL) return [];

  const { rows } = await getPool().query<ListingRow>(
    `SELECT * FROM listings
     WHERE embedding IS NULL AND missing_runs < $1
     ORDER BY title ASC`,
    [getListingMissingRunsLimit()],
  );

  return rows.map(rowToListing);
}
```

with:

```ts
export async function listListingsMissingEmbedding(): Promise<Listing[]> {
  if (!process.env.DATABASE_URL) return [];

  const { rows } = await getPool().query<ListingRow>(
    `SELECT * FROM listings
     WHERE (structured_embedding IS NULL OR description_embedding IS NULL) AND missing_runs < $1
     ORDER BY title ASC`,
    [getListingMissingRunsLimit()],
  );

  return rows.map(rowToListing);
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run lib/db/listings-search.test.ts lib/db/listings-sync.test.ts`
Expected: PASS — all tests in both files.

- [ ] **Step 8: Commit**

```bash
git add lib/db/listings.ts lib/db/listings-search.test.ts lib/db/listings-sync.test.ts
git commit -m "feat(db): search and write dual structured/description embedding columns"
```

---

### Task 4: Interleaved batching in the embed sync

Changes `lib/sync/embed-listings.ts` to embed both texts per listing in one call, 16 listings (32 texts) per chunk, and de-interleave the results back onto the two columns.

**Files:**
- Modify: `lib/sync/embed-listings.ts`
- Test: `lib/sync/embed-listings.test.ts`

**Interfaces:**
- Consumes: `buildStructuredEmbeddingText`, `buildDescriptionEmbeddingText` (Task 2); `updateListingEmbeddings` (Task 3); `forEachChunkPaced` from `lib/sync/pace.ts` (unchanged).
- Produces: `embedAllListings()`, `embedListingsMissingEmbedding()` — same signatures as before, `Promise<number>` (count of listings embedded).

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `lib/sync/embed-listings.test.ts` with:

```ts
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../db/listings", () => ({
  listListingsMissingEmbedding: vi.fn(),
  updateListingEmbeddings: vi.fn(),
}));

vi.mock("../ai/client", () => ({
  embedTexts: vi.fn(),
}));

import { embedTexts } from "../ai/client";
import { listListingsMissingEmbedding, updateListingEmbeddings } from "../db/listings";
import { embedListingsMissingEmbedding } from "./embed-listings";

function makeListing(i: number) {
  return {
    id: `listing-${i}`,
    source: "coworker" as const,
    sourceId: `source-${i}`,
    slug: `koramangala-spot-${i}`,
    title: "Koramangala Spot",
    description: "A bright workspace",
    shortTeaser: "Bright workspace",
    address: "1st Block",
    area: "Koramangala",
    city: "Bengaluru",
    lat: 12.93,
    lng: 77.62,
    amenities: ["WiFi", "AC"],
    images: [],
    pricingHint: "under 15k",
    propertyType: "Coworking",
    sourceUrl: `https://example.com/listing-${i}`,
    syncedAt: "2026-07-23T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.useRealTimers();
});

it("embeds structured and description texts per listing and de-interleaves the vectors", async () => {
  vi.mocked(listListingsMissingEmbedding).mockResolvedValue([makeListing(1)]);
  vi.mocked(embedTexts).mockResolvedValue([
    [0.1, 0.2],
    [0.3, 0.4],
  ]);

  await expect(embedListingsMissingEmbedding()).resolves.toBe(1);

  expect(embedTexts).toHaveBeenCalledWith([
    expect.stringContaining("Koramangala Spot"),
    expect.stringContaining("Bright workspace"),
  ]);
  expect(updateListingEmbeddings).toHaveBeenCalledWith("listing-1", {
    structured: [0.1, 0.2],
    description: [0.3, 0.4],
  });
});

it("sends 32 interleaved texts for a full 16-listing chunk", async () => {
  const listings = Array.from({ length: 16 }, (_, i) => makeListing(i));
  vi.mocked(listListingsMissingEmbedding).mockResolvedValue(listings);
  vi.mocked(embedTexts).mockResolvedValue(Array.from({ length: 32 }, (_, i) => [i]));

  await expect(embedListingsMissingEmbedding()).resolves.toBe(16);

  expect(embedTexts).toHaveBeenCalledTimes(1);
  expect(embedTexts.mock.calls[0][0]).toHaveLength(32);
  expect(updateListingEmbeddings).toHaveBeenCalledWith("listing-0", {
    structured: [0],
    description: [1],
  });
  expect(updateListingEmbeddings).toHaveBeenCalledWith("listing-15", {
    structured: [30],
    description: [31],
  });
});

it("splits into multiple chunks when more than 16 listings need embedding", async () => {
  vi.useFakeTimers();
  const listings = Array.from({ length: 17 }, (_, i) => makeListing(i));
  vi.mocked(listListingsMissingEmbedding).mockResolvedValue(listings);
  vi.mocked(embedTexts)
    .mockResolvedValueOnce(Array.from({ length: 32 }, (_, i) => [i]))
    .mockResolvedValueOnce([[100], [101]]);

  const resultPromise = embedListingsMissingEmbedding();
  await vi.advanceTimersByTimeAsync(32_000);
  await expect(resultPromise).resolves.toBe(17);

  expect(embedTexts).toHaveBeenCalledTimes(2);
  expect(embedTexts.mock.calls[0][0]).toHaveLength(32);
  expect(embedTexts.mock.calls[1][0]).toHaveLength(2);
  expect(updateListingEmbeddings).toHaveBeenCalledWith("listing-16", {
    structured: [100],
    description: [101],
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/sync/embed-listings.test.ts`
Expected: FAIL — `updateListingEmbeddings` mock is unused/mismatched against the current `updateListingEmbedding`-based implementation, and the interleaved-call assertions don't match today's single-text-per-listing calls.

- [ ] **Step 3: Implement interleaved batching**

Replace the entire contents of `lib/sync/embed-listings.ts` with:

```ts
import { listListings, listListingsMissingEmbedding, updateListingEmbeddings } from "../db/listings";
import { buildDescriptionEmbeddingText, buildStructuredEmbeddingText } from "../listings/embedding-text";
import { embedTexts } from "../ai/client";
import { forEachChunkPaced } from "./pace";

// Each listing now contributes 2 texts (structured + description) instead of 1,
// so halving listings-per-chunk keeps the same 32-texts-per-Vertex-call batch
// size as before the split.
const LISTINGS_PER_CHUNK = 16;
// Vertex AI's default quota for text-embedding-004 (billed under the legacy
// "textembedding-gecko" metric) is only 5 requests/min per region on a fresh
// GCP project. Pacing to ~30 listings/min keeps us well under that — even
// though halving LISTINGS_PER_CHUNK roughly doubles call frequency (~1.9
// calls/min vs. ~0.9 calls/min pre-split), both stay well under the 5/min
// ceiling.
const ITEMS_PER_MINUTE = 30;

export async function embedAllListings(): Promise<number> {
  const listings = await listListings();
  return embedListings(listings);
}

export async function embedListingsMissingEmbedding(): Promise<number> {
  const listings = await listListingsMissingEmbedding();
  return embedListings(listings);
}

function interleaveTexts(structured: string[], descriptions: string[]): string[] {
  const texts: string[] = [];
  for (let i = 0; i < structured.length; i++) {
    texts.push(structured[i], descriptions[i]);
  }
  return texts;
}

async function embedListings(listings: Awaited<ReturnType<typeof listListings>>): Promise<number> {
  let n = 0;
  await forEachChunkPaced(listings, LISTINGS_PER_CHUNK, ITEMS_PER_MINUTE, async (chunk) => {
    const structuredTexts = chunk.map(buildStructuredEmbeddingText);
    const descriptionTexts = chunk.map(buildDescriptionEmbeddingText);
    const vectors = await embedTexts(interleaveTexts(structuredTexts, descriptionTexts));

    for (let j = 0; j < chunk.length; j++) {
      await updateListingEmbeddings(chunk[j].id, {
        structured: vectors[2 * j],
        description: vectors[2 * j + 1],
      });
      n++;
    }
  });
  return n;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/sync/embed-listings.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — all files, no regressions (in particular `lib/graph/rebuild.test.ts` and `app/api/spaces/search/route.test.ts`, which are untouched by this feature).

- [ ] **Step 6: Commit**

```bash
git add lib/sync/embed-listings.ts lib/sync/embed-listings.test.ts
git commit -m "feat(sync): interleave structured/description texts in one embed call per chunk"
```

---

### Task 5: Local backfill verification and docs

Applies the migration's real-world consequence — every existing listing needs re-embedding into both new columns — by running the existing `embed:backfill` script against the local Docker Postgres, then records the feature in project docs.

**Files:**
- Modify: `README.md` (embedding note)
- Modify: `openmemory.md` (Architecture + Patterns)

**Interfaces:**
- Consumes: `embedListingsMissingEmbedding()` (Task 4) via the existing `scripts/backfill-embeddings.ts` and `npm run embed:backfill` — no script changes needed since `listListingsMissingEmbedding()` already treats either-column-null as needing embedding.

- [ ] **Step 1: Run the local backfill**

With the local stack up (`docker compose -f docker-compose.listings.yml up -d`, migration `006` already applied in Task 1, `.env.local` configured per README's Vertex section), run:

```bash
npm run embed:backfill
```

Expected: `embedded N listings` where `N` matches the local listing count (per `openmemory.md`, 10 local Coworker listings as of 2026-07-23 — the exact number may differ if more were synced since).

- [ ] **Step 2: Verify both columns are populated**

Run:

```bash
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings -c \
  "SELECT count(*) FILTER (WHERE structured_embedding IS NOT NULL) AS structured, count(*) FILTER (WHERE description_embedding IS NOT NULL) AS description, count(*) AS total FROM listings;"
```

Expected: `structured` and `description` both equal `total` (every listing has both vectors).

- [ ] **Step 3: Update the README's embedding note**

In `README.md`, in the "Listing privacy (read boundary)" paragraph, replace:

```markdown
All server→client listing payloads pass through `toPublicListing()` in `lib/listings/public.ts`; raw DB values stay server-side for sync, embeddings, graph scoring, and Places lookups.
```

with:

```markdown
All server→client listing payloads pass through `toPublicListing()` in `lib/listings/public.ts`; raw DB values stay server-side for sync, embeddings, graph scoring, and Places lookups. AI search embeds two vectors per listing — `structured_embedding` (title/area/city/type/price/amenities) and `description_embedding` (teaser + description) — and takes the higher cosine similarity of the two at query time (`GREATEST(...)` in `searchListingsByEmbedding()`), so a fact buried in a long description can surface a listing on its own instead of being diluted by a single blended vector.
```

- [ ] **Step 4: Update project memory**

In `openmemory.md`, in the **Architecture** section, replace:

```markdown
- **AI search**: `POST /api/spaces/search` — vector-first pgvector rank-boost; optional Apache AGE GraphRAG scoring when configured.
```

with:

```markdown
- **AI search**: `POST /api/spaces/search` — vector-first pgvector rank-boost; optional Apache AGE GraphRAG scoring when configured. Each listing has two embedding columns (`structured_embedding`, `description_embedding`, migration `006_split_embeddings.sql`); `searchListingsByEmbedding()` takes `GREATEST()` of both cosine similarities per row rather than averaging one blended vector.
```

In the **Patterns** section, add after the `buildInsight()` cache bullet:

```markdown
- Listing embeddings are split into `structured_embedding` (title/area/city/propertyType/pricingHint/amenities, via `buildStructuredEmbeddingText()`) and `description_embedding` (shortTeaser/description, via `buildDescriptionEmbeddingText()`), both built in `lib/listings/embedding-text.ts`. `lib/sync/embed-listings.ts` embeds both per listing in one interleaved Vertex call (`LISTINGS_PER_CHUNK = 16` listings × 2 texts = 32 texts/call, same batch size as before the split); `listListingsMissingEmbedding()` treats either column being `NULL` as needing embedding, so backfill is automatic via the normal sync/embed pass. Entity extraction (`lib/graph/*`) is untouched and still uses the original combined `buildListingEmbeddingText()`.
```

- [ ] **Step 5: Run the full suite one last time**

Run: `npm test`
Expected: PASS — all tests.

- [ ] **Step 6: Commit**

```bash
git add README.md openmemory.md
git commit -m "chore(embeddings): document structured/description split and verify local backfill"
```

---

## Verification checklist

- [ ] `npm test` passes with no regressions.
- [ ] `docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings -c '\d listings'` shows `structured_embedding` and `description_embedding`, not `embedding`.
- [ ] `npm run embed:backfill` reports embedding every local listing; the psql count check in Task 5 Step 2 shows both columns fully populated.
- [ ] On `/spaces` locally (`npm run dev`), run an AI search for a fact that only appears in one listing's free-text description (not in its title/area/amenities) and confirm that listing now surfaces — this is the concrete behavior this feature exists to fix.
- [ ] Only after the above pass locally: deploy migration `006` + the updated image to the GCP VM (same `gcloud compute scp` + rebuild pattern used for prior fixes), run the sync there, and spot-check `gentlespacesolutions.com` search results — this is a manual follow-up, not a plan task.
