# Incremental Listings Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace destructive full-catalog replacement with per-source upserts and TTL-based detail refresh so Firecrawl, Vertex, and Gemini usage scales with changed listings.

**Architecture:** Split each source adapter into `discover()` and `fetchDetail()`, then let one orchestrator compare discovery results with compact database metadata and scrape only new, stale, or reactivated listings. Apply each source atomically, preserve stable IDs/slugs, soft-hide after three successful missed discoveries, and update embeddings/AGE only for affected rows.

**Tech Stack:** TypeScript, Next.js 15.5, PostgreSQL 16 + pgvector + Apache AGE, Firecrawl v1 REST API, Vitest, Node `crypto`.

## Global Constraints

- `LISTING_DETAIL_TTL_DAYS` defaults to `7`.
- `LISTING_MISSING_RUNS_LIMIT` defaults to `3`.
- A failed or empty discovery writes nothing and does not increment `missing_runs`.
- A discovery touch updates `last_seen_at` and resets `missing_runs`, but never updates `synced_at`.
- IDs and slugs remain stable after initial insert.
- Existing adapters' parsing behavior is out of scope; do not fix myHQ/CoFynd discovery or coordinates here.
- Do not migrate Firecrawl from v1 to v2 or add a dependency.
- Detail scrapes request markdown only; discovery scrapes request markdown + links.
- Use TDD: every production behavior starts with a failing focused test.
- Preserve the existing `npm run graph:rebuild` full recovery path.

---

### Task 1: Add deterministic hashes and sync policy configuration

**Files:**
- Create: `lib/sync/content-hash.ts`
- Create: `lib/sync/content-hash.test.ts`
- Create: `lib/sync/config.ts`
- Create: `lib/sync/config.test.ts`

**Interfaces:**
- Produces: `contentHash(raw: RawListing): string`
- Produces: `embedHash(raw: RawListing): string`
- Produces: `getListingDetailTtlMs(): number`
- Produces: `getListingMissingRunsLimit(): number`
- Consumes: existing `RawListing` and `buildListingEmbeddingText()`

- [ ] **Step 1: Write failing hash tests**

```typescript
// lib/sync/content-hash.test.ts
import { describe, expect, it } from "vitest";
import type { RawListing } from "./sources/types";
import { contentHash, embedHash } from "./content-hash";

const row = (over: Partial<RawListing> = {}): RawListing => ({
  source: "coworker",
  sourceId: "space-1",
  title: "Space One",
  description: "Quiet workspace",
  shortTeaser: "Quiet workspace",
  address: "1 Main Road",
  area: "Bellandur",
  city: "Bengaluru",
  lat: 12.93,
  lng: 77.69,
  amenities: ["WiFi", "Coffee"],
  images: ["https://img.example/one.jpg"],
  pricingHint: "₹10,000/month",
  propertyType: "Coworking",
  sourceUrl: "https://example.com/space-1",
  ...over,
});

describe("listing content hashes", () => {
  it("is deterministic and ignores amenity ordering", () => {
    expect(contentHash(row())).toBe(contentHash(row({ amenities: ["Coffee", "WiFi"] })));
    expect(embedHash(row())).toBe(embedHash(row({ amenities: ["Coffee", "WiFi"] })));
  });

  it("changes both hashes when embedding text changes", () => {
    expect(contentHash(row({ pricingHint: "₹12,000/month" }))).not.toBe(contentHash(row()));
    expect(embedHash(row({ pricingHint: "₹12,000/month" }))).not.toBe(embedHash(row()));
  });

  it("does not re-embed an image-only change", () => {
    const changed = row({ images: ["https://img.example/two.jpg"] });
    expect(contentHash(changed)).not.toBe(contentHash(row()));
    expect(embedHash(changed)).toBe(embedHash(row()));
  });
});
```

- [ ] **Step 2: Run hash tests and verify RED**

Run: `npm test -- lib/sync/content-hash.test.ts`

Expected: FAIL because `./content-hash` does not exist.

- [ ] **Step 3: Implement deterministic hashes**

```typescript
// lib/sync/content-hash.ts
import { createHash } from "node:crypto";
import { buildListingEmbeddingText } from "../listings/embedding-text";
import type { RawListing } from "./sources/types";

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export function contentHash(row: RawListing): string {
  return sha256({
    source: row.source,
    sourceId: row.sourceId,
    title: row.title.trim(),
    description: row.description.trim(),
    shortTeaser: row.shortTeaser.trim(),
    address: row.address.trim(),
    area: row.area.trim(),
    city: row.city.trim(),
    lat: row.lat,
    lng: row.lng,
    amenities: sortedUnique(row.amenities),
    images: row.images,
    pricingHint: row.pricingHint?.trim() ?? null,
    propertyType: row.propertyType?.trim() ?? null,
    sourceUrl: row.sourceUrl,
  });
}

export function embedHash(row: RawListing): string {
  return sha256(
    buildListingEmbeddingText({
      ...row,
      amenities: sortedUnique(row.amenities),
    }),
  );
}
```

- [ ] **Step 4: Write failing configuration tests**

```typescript
// lib/sync/config.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { getListingDetailTtlMs, getListingMissingRunsLimit } from "./config";

afterEach(() => {
  delete process.env.LISTING_DETAIL_TTL_DAYS;
  delete process.env.LISTING_MISSING_RUNS_LIMIT;
});

describe("sync config", () => {
  it("uses safe defaults", () => {
    expect(getListingDetailTtlMs()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(getListingMissingRunsLimit()).toBe(3);
  });

  it("accepts positive integer overrides and rejects unsafe values", () => {
    process.env.LISTING_DETAIL_TTL_DAYS = "2";
    process.env.LISTING_MISSING_RUNS_LIMIT = "5";
    expect(getListingDetailTtlMs()).toBe(2 * 24 * 60 * 60 * 1000);
    expect(getListingMissingRunsLimit()).toBe(5);

    process.env.LISTING_DETAIL_TTL_DAYS = "0";
    expect(() => getListingDetailTtlMs()).toThrow(/LISTING_DETAIL_TTL_DAYS/);
  });
});
```

- [ ] **Step 5: Run config tests and verify RED**

Run: `npm test -- lib/sync/config.test.ts`

Expected: FAIL because `./config` does not exist.

- [ ] **Step 6: Implement configuration parsing**

```typescript
// lib/sync/config.ts
const DAY_MS = 24 * 60 * 60 * 1000;

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function getListingDetailTtlMs(): number {
  return positiveInteger("LISTING_DETAIL_TTL_DAYS", 7) * DAY_MS;
}

export function getListingMissingRunsLimit(): number {
  return positiveInteger("LISTING_MISSING_RUNS_LIMIT", 3);
}
```

- [ ] **Step 7: Run focused tests**

Run: `npm test -- lib/sync/content-hash.test.ts lib/sync/config.test.ts`

Expected: 2 test files pass.

- [ ] **Step 8: Commit**

```bash
git add lib/sync/content-hash.ts lib/sync/content-hash.test.ts lib/sync/config.ts lib/sync/config.test.ts
git commit -m "feat(sync): add listing change hashes and policy config"
```

---

### Task 2: Add the pure scrape planner and bounded concurrency

**Files:**
- Create: `lib/sync/plan.ts`
- Create: `lib/sync/plan.test.ts`
- Create: `lib/sync/concurrency.ts`
- Create: `lib/sync/concurrency.test.ts`

**Interfaces:**
- Produces: `ExistingListingSyncState`
- Produces: `planSourceSync(discovered, existing, now, ttlMs, missingLimit): SourceSyncPlan`
- Produces: `mapSettledWithConcurrency(items, limit, mapper)`
- Consumes: `DiscoveredListing` from Task 4; define the type in `plan.ts` temporarily and switch to the adapter export in Task 4.

- [ ] **Step 1: Write failing planner tests**

```typescript
// lib/sync/plan.test.ts
import { describe, expect, it } from "vitest";
import { planSourceSync, type ExistingListingSyncState } from "./plan";

const now = new Date("2026-07-30T00:00:00.000Z");
const discovered = [
  { sourceId: "fresh", url: "https://example.com/fresh" },
  { sourceId: "stale", url: "https://example.com/stale" },
  { sourceId: "new", url: "https://example.com/new" },
  { sourceId: "hidden", url: "https://example.com/hidden" },
];
const existing: ExistingListingSyncState[] = [
  {
    sourceId: "fresh",
    id: "id-fresh",
    slug: "fresh",
    syncedAt: new Date("2026-07-29T00:00:00.000Z"),
    contentHash: "content",
    embedHash: "embed",
    missingRuns: 0,
  },
  {
    sourceId: "stale",
    id: "id-stale",
    slug: "stale",
    syncedAt: new Date("2026-07-01T00:00:00.000Z"),
    contentHash: "content",
    embedHash: "embed",
    missingRuns: 0,
  },
  {
    sourceId: "hidden",
    id: "id-hidden",
    slug: "hidden",
    syncedAt: new Date("2026-07-29T00:00:00.000Z"),
    contentHash: "content",
    embedHash: "embed",
    missingRuns: 3,
  },
];

it("scrapes new, stale, unknown-hash, and reactivated listings only", () => {
  const plan = planSourceSync(discovered, existing, now, 7 * 86_400_000, 3);
  expect(plan.toScrape.map((item) => item.sourceId)).toEqual(["stale", "new", "hidden"]);
  expect(plan.toTouch.map((item) => item.sourceId)).toEqual(["fresh"]);
});

it("does not mutate an empty discovery result", () => {
  expect(planSourceSync([], existing, now, 7 * 86_400_000, 3)).toEqual({
    toScrape: [],
    toTouch: [],
  });
});
```

- [ ] **Step 2: Run planner test and verify RED**

Run: `npm test -- lib/sync/plan.test.ts`

Expected: FAIL because `./plan` does not exist.

- [ ] **Step 3: Implement the planner**

```typescript
// lib/sync/plan.ts
export type DiscoveredListing = { sourceId: string; url: string };

export type ExistingListingSyncState = {
  sourceId: string;
  id: string;
  slug: string;
  syncedAt: Date;
  contentHash: string | null;
  embedHash: string | null;
  missingRuns: number;
};

export type SourceSyncPlan = {
  toScrape: DiscoveredListing[];
  toTouch: DiscoveredListing[];
};

export function planSourceSync(
  discovered: DiscoveredListing[],
  existing: ExistingListingSyncState[],
  now: Date,
  ttlMs: number,
  missingLimit: number,
): SourceSyncPlan {
  const byId = new Map(existing.map((row) => [row.sourceId, row]));
  const unique = [...new Map(discovered.map((row) => [row.sourceId, row])).values()];
  const toScrape: DiscoveredListing[] = [];
  const toTouch: DiscoveredListing[] = [];

  for (const item of unique) {
    const previous = byId.get(item.sourceId);
    const stale = previous ? now.getTime() - previous.syncedAt.getTime() >= ttlMs : true;
    if (
      !previous ||
      previous.contentHash == null ||
      previous.embedHash == null ||
      previous.missingRuns >= missingLimit ||
      stale
    ) {
      toScrape.push(item);
    } else {
      toTouch.push(item);
    }
  }
  return { toScrape, toTouch };
}
```

- [ ] **Step 4: Write failing concurrency tests**

```typescript
// lib/sync/concurrency.test.ts
import { expect, it } from "vitest";
import { mapSettledWithConcurrency } from "./concurrency";

it("caps active work and preserves item order", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapSettledWithConcurrency([1, 2, 3, 4], 2, async (value) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return value * 2;
  });
  expect(peak).toBe(2);
  expect(result).toEqual([
    { status: "fulfilled", value: 2 },
    { status: "fulfilled", value: 4 },
    { status: "fulfilled", value: 6 },
    { status: "fulfilled", value: 8 },
  ]);
});
```

- [ ] **Step 5: Run concurrency test and verify RED**

Run: `npm test -- lib/sync/concurrency.test.ts`

Expected: FAIL because `./concurrency` does not exist.

- [ ] **Step 6: Implement bounded settled mapping**

```typescript
// lib/sync/concurrency.ts
export async function mapSettledWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("concurrency must be >= 1");
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await mapper(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}
```

- [ ] **Step 7: Run focused tests**

Run: `npm test -- lib/sync/plan.test.ts lib/sync/concurrency.test.ts`

Expected: 2 test files pass.

- [ ] **Step 8: Commit**

```bash
git add lib/sync/plan.ts lib/sync/plan.test.ts lib/sync/concurrency.ts lib/sync/concurrency.test.ts
git commit -m "feat(sync): plan TTL scrapes with bounded concurrency"
```

---

### Task 3: Add the incremental schema and atomic per-source persistence

**Files:**
- Create: `lib/db/migrations/005_incremental_sync.sql`
- Modify: `lib/db/schema.sql:3-37`
- Modify: `lib/db/listings.ts:9-158`
- Create: `lib/db/listings-sync.test.ts`
- Modify: `lib/db/listings-search.test.ts:14-66`
- Modify: `lib/listings/types.ts:24-32`
- Modify: `lib/db/sync-runs.ts:4-57`
- Create: `lib/db/sync-runs.test.ts`

**Interfaces:**
- Consumes: `ExistingListingSyncState` from Task 2
- Produces: `PreparedListing`, `SourceWriteResult`
- Produces: `listExistingForSource(source)`
- Produces: `applySourceSync(input)` — one database transaction for upsert + seen + missing
- Produces: `listListingsMissingEmbedding()`
- Produces: `countVisibleListings()`
- Produces: `finishSyncRun(id, status, count, error, sources)`

- [ ] **Step 1: Write the migration**

```sql
-- lib/db/migrations/005_incremental_sync.sql
BEGIN;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS missing_runs INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS embed_hash TEXT;

UPDATE listings SET last_seen_at = synced_at WHERE last_seen_at IS NULL;
ALTER TABLE listings ALTER COLUMN last_seen_at SET NOT NULL;

ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS listings_source_missing_idx
  ON listings (source, missing_runs);

COMMIT;
```

Mirror these columns and the `sources` default in `lib/db/schema.sql` so a fresh database
matches the migration path.

- [ ] **Step 2: Write failing atomic persistence tests**

```typescript
// lib/db/listings-sync.test.ts
import { beforeEach, expect, it, vi } from "vitest";

const query = vi.fn();
const release = vi.fn();
const connect = vi.fn(async () => ({ query, release }));
vi.mock("./client", () => ({ getPool: () => ({ connect, query }) }));

import { applySourceSync } from "./listings";

beforeEach(() => {
  query.mockReset();
  release.mockReset();
});

it("upserts scraped rows, touches every discovered id, and increments only unseen rows", async () => {
  query
    .mockResolvedValueOnce({ rows: [] }) // BEGIN
    .mockResolvedValueOnce({ rows: [{ id: "stable-id", slug: "stable-slug" }] }) // upsert
    .mockResolvedValueOnce({ rows: [] }) // mark seen
    .mockResolvedValueOnce({ rows: [{ id: "hidden-id", missing_runs: 3 }] }) // missing
    .mockResolvedValueOnce({ rows: [] }); // COMMIT

  const result = await applySourceSync({
    source: "coworker",
    discoveredSourceIds: ["seen", "scraped"],
    scraped: [{
      listing: {
        id: "stable-id",
        source: "coworker",
        sourceId: "scraped",
        slug: "stable-slug",
        title: "Space",
        description: "Description",
        shortTeaser: "Description",
        address: "Address",
        area: "Bellandur",
        city: "Bengaluru",
        lat: 12.9,
        lng: 77.6,
        amenities: ["WiFi"],
        images: [],
        pricingHint: null,
        propertyType: "Coworking",
        sourceUrl: "https://example.com/scraped",
        syncedAt: "2026-07-30T00:00:00.000Z",
      },
      contentHash: "content-new",
      embedHash: "embed-new",
      isNew: false,
      previousContentHash: "content-old",
      previousEmbedHash: "embed-old",
      wasHidden: false,
    }],
    missingLimit: 3,
    trackMissing: true,
  });

  expect(result.updated).toBe(1);
  expect(result.newlyHiddenIds).toEqual(["hidden-id"]);
  expect(query.mock.calls[1][0]).toContain("ON CONFLICT (source, source_id)");
  expect(query.mock.calls[1][0]).toContain("THEN NULL ELSE listings.embedding");
  expect(query.mock.calls[2][0]).toContain("missing_runs = 0");
  expect(query.mock.calls[2][0]).not.toContain("synced_at");
  expect(query.mock.calls[3][0]).toContain("missing_runs < $3");
  expect(release).toHaveBeenCalledOnce();
});

it("rolls back the complete source write on failure", async () => {
  query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error("write failed"));
  await expect(applySourceSync({
    source: "coworker",
    discoveredSourceIds: ["one"],
    scraped: [],
    missingLimit: 3,
    trackMissing: true,
  })).rejects.toThrow("write failed");
  expect(query).toHaveBeenCalledWith("ROLLBACK");
});
```

- [ ] **Step 3: Run persistence test and verify RED**

Run: `npm test -- lib/db/listings-sync.test.ts`

Expected: FAIL because `applySourceSync` is not exported.

- [ ] **Step 4: Add sync persistence types and functions**

Add to `lib/db/listings.ts`:

```typescript
import type { ExistingListingSyncState } from "../sync/plan";

export type PreparedListing = {
  listing: Listing;
  contentHash: string;
  embedHash: string;
  isNew: boolean;
  previousContentHash: string | null;
  previousEmbedHash: string | null;
  wasHidden: boolean;
};

export type SourceWriteResult = {
  inserted: number;
  updated: number;
  unchanged: number;
  graphListings: Listing[];
  newlyHiddenIds: string[];
};

export async function listExistingForSource(
  source: ListingSource,
): Promise<ExistingListingSyncState[]> {
  const { rows } = await getPool().query<{
    source_id: string; id: string; slug: string; synced_at: Date;
    content_hash: string | null; embed_hash: string | null; missing_runs: number;
  }>(
    `SELECT source_id, id, slug, synced_at, content_hash, embed_hash, missing_runs
     FROM listings WHERE source = $1`,
    [source],
  );
  return rows.map((row) => ({
    sourceId: row.source_id,
    id: row.id,
    slug: row.slug,
    syncedAt: row.synced_at,
    contentHash: row.content_hash,
    embedHash: row.embed_hash,
    missingRuns: row.missing_runs,
  }));
}

export async function applySourceSync(input: {
  source: ListingSource;
  discoveredSourceIds: string[];
  scraped: PreparedListing[];
  missingLimit: number;
  trackMissing: boolean;
}): Promise<SourceWriteResult> {
  const client = await getPool().connect();
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const graphListings: Listing[] = [];
  try {
    await client.query("BEGIN");
    for (const row of input.scraped) {
      const changed = row.previousContentHash !== row.contentHash;
      const embeddingChanged = row.previousEmbedHash !== row.embedHash;
      if (row.isNew) inserted++;
      else if (changed) updated++;
      else unchanged++;

      const values = [
        row.listing.id, row.listing.source, row.listing.sourceId, row.listing.slug,
        row.listing.title, row.listing.description, row.listing.shortTeaser,
        row.listing.address, row.listing.area, row.listing.city, row.listing.lat,
        row.listing.lng, JSON.stringify(row.listing.amenities),
        JSON.stringify(row.listing.images), row.listing.pricingHint,
        row.listing.propertyType, row.listing.sourceUrl, row.listing.syncedAt,
        row.contentHash, row.embedHash,
      ];
      const { rows } = await client.query<{ id: string; slug: string }>(
        `INSERT INTO listings (
           id, source, source_id, slug, title, description, short_teaser, address,
           area, city, lat, lng, amenities, images, pricing_hint, property_type,
           source_url, synced_at, last_seen_at, content_hash, embed_hash
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,
           $15,$16,$17,$18::timestamptz,NOW(),$19,$20
         )
         ON CONFLICT (source, source_id) DO UPDATE SET
           title = EXCLUDED.title, description = EXCLUDED.description,
           short_teaser = EXCLUDED.short_teaser, address = EXCLUDED.address,
           area = EXCLUDED.area, city = EXCLUDED.city, lat = EXCLUDED.lat,
           lng = EXCLUDED.lng, amenities = EXCLUDED.amenities, images = EXCLUDED.images,
           pricing_hint = EXCLUDED.pricing_hint, property_type = EXCLUDED.property_type,
           source_url = EXCLUDED.source_url, synced_at = EXCLUDED.synced_at,
           last_seen_at = NOW(), missing_runs = 0,
           content_hash = EXCLUDED.content_hash, embed_hash = EXCLUDED.embed_hash,
           embedding = CASE
             WHEN listings.embed_hash IS DISTINCT FROM EXCLUDED.embed_hash THEN NULL
             ELSE listings.embedding
           END
         RETURNING id, slug`,
        values,
      );
      row.listing.id = rows[0].id;
      row.listing.slug = rows[0].slug;
      if (row.isNew || embeddingChanged || row.wasHidden) {
        graphListings.push(row.listing);
      }
    }

    await client.query(
      `UPDATE listings SET last_seen_at = NOW(), missing_runs = 0
       WHERE source = $1 AND source_id = ANY($2::text[])`,
      [input.source, input.discoveredSourceIds],
    );

    let newlyHiddenIds: string[] = [];
    if (input.trackMissing) {
      const hidden = await client.query<{ id: string; missing_runs: number }>(
        `UPDATE listings
         SET missing_runs = LEAST(missing_runs + 1, $3)
         WHERE source = $1
           AND NOT (source_id = ANY($2::text[]))
           AND missing_runs < $3
         RETURNING id, missing_runs`,
        [input.source, input.discoveredSourceIds, input.missingLimit],
      );
      newlyHiddenIds = hidden.rows
        .filter((row) => row.missing_runs === input.missingLimit)
        .map((row) => row.id);
    }
    await client.query("COMMIT");
    return { inserted, updated, unchanged, graphListings, newlyHiddenIds };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
```

Keep `id` and `slug` out of the conflict update. An unchanged scrape still updates
`synced_at`, satisfying the rule that every actual detail scrape refreshes the database.

- [ ] **Step 5: Add visibility filtering and read-time cross-source dedupe**

Add `missing_runs` to `ListingRow`, then use the configured limit:

```typescript
const visibleLimit = getListingMissingRunsLimit();

// listListings
SELECT * FROM listings WHERE missing_runs < $1 ORDER BY title ASC

// getListingBySlug
SELECT * FROM listings WHERE slug = $1 AND missing_runs < $2 LIMIT 1

// vector search: fetch up to four source variants, dedupe by the existing
// dedupeListings() source-priority rule, then slice to k.
WHERE embedding IS NOT NULL AND missing_runs < $2
ORDER BY embedding <=> $1::vector
LIMIT $3
```

Pass `[vectorLiteral, visibleLimit, k * 4]`, map all scored rows, run
`dedupeListings(scored.map(row => row.listing))`, then recover scores by ID and return the
first `k`. This preserves the old ingestion-time cross-source dedupe without deleting the
lower-priority source row that may later become the fallback.

Add:

```typescript
export async function listListingsMissingEmbedding(): Promise<Listing[]> {
  const { rows } = await getPool().query<ListingRow>(
    `SELECT * FROM listings
     WHERE embedding IS NULL AND missing_runs < $1
     ORDER BY title ASC`,
    [getListingMissingRunsLimit()],
  );
  return rows.map(rowToListing);
}

export async function countVisibleListings(): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM listings WHERE missing_runs < $1",
    [getListingMissingRunsLimit()],
  );
  return Number(rows[0]?.count ?? 0);
}
```

- [ ] **Step 6: Update search tests**

Extend `sampleRow` with `missing_runs: 0`, assert the SQL contains
`missing_runs < $2`, and change the expected arguments to
`["[0.1,0.2,0.3]", 3, 20]` for `k = 5`.

Run: `npm test -- lib/db/listings-search.test.ts lib/db/listings-sync.test.ts`

Expected: both pass.

- [ ] **Step 7: Add per-source sync-run outcomes**

In `lib/listings/types.ts`:

```typescript
export type SourceSyncOutcome = {
  status: "success" | "failed";
  discovered: number;
  scraped: number;
  inserted: number;
  updated: number;
  unchanged: number;
  hidden: number;
  error: string | null;
};

// Add to SyncRun:
sources: Partial<Record<ListingSource, SourceSyncOutcome>>;
```

Add `sources: unknown` to `SyncRunRow`, map it with a guarded object fallback, and change
`finishSyncRun()` to accept `sources: SyncRun["sources"]` and execute:

```sql
UPDATE sync_runs
SET finished_at = NOW(), status = $2, count = $3, error = $4, sources = $5::jsonb
WHERE id = $1
```

Write `lib/db/sync-runs.test.ts` to assert `rowToSyncRun` returns `{}` for absent source
data and `finishSyncRun` serializes the outcome JSON.

- [ ] **Step 8: Run focused database tests**

Run: `npm test -- lib/db/listings-sync.test.ts lib/db/listings-search.test.ts lib/db/sync-runs.test.ts`

Expected: 3 test files pass.

- [ ] **Step 9: Commit**

```bash
git add lib/db/migrations/005_incremental_sync.sql lib/db/schema.sql lib/db/listings.ts \
  lib/db/listings-sync.test.ts lib/db/listings-search.test.ts lib/listings/types.ts \
  lib/db/sync-runs.ts lib/db/sync-runs.test.ts
git commit -m "feat(sync): persist listings incrementally per source"
```

---

### Task 4: Split source adapters and slim Firecrawl detail responses

**Files:**
- Modify: `lib/firecrawl/client.ts:27-39`
- Create: `lib/firecrawl/client.test.ts`
- Modify: `lib/sync/sources/types.ts:21-24`
- Modify: `lib/sync/sources/index.ts:1-5`
- Modify: `lib/sync/sources/coworker.ts:161-205`
- Modify: `lib/sync/sources/myhq.ts:152-188`
- Modify: `lib/sync/sources/cofynd.ts:179-215`
- Modify: `lib/sync/sources/gofloaters.ts:186-231`
- Modify tests: `lib/sync/sources/{coworker,myhq,cofynd,gofloaters}.test.ts`

**Interfaces:**
- Produces: `DiscoveredListing`
- Produces: `SourceAdapter.discover()`
- Produces: `SourceAdapter.fetchDetail(url)`
- Consumes: `mapSettledWithConcurrency()` from Task 2

- [ ] **Step 1: Write a failing Firecrawl response-shape test**

```typescript
// lib/firecrawl/client.test.ts
import { afterEach, expect, it, vi } from "vitest";
import { firecrawlScrape } from "./client";

afterEach(() => vi.unstubAllGlobals());

it("requests links only for discovery scrapes", async () => {
  process.env.FIRECRAWL_API_KEY = "test";
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { markdown: "page", links: [] } }),
  });
  vi.stubGlobal("fetch", fetch);

  await firecrawlScrape("https://example.com/detail");
  await firecrawlScrape("https://example.com/index", { includeLinks: true });

  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ formats: ["markdown"] });
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
    formats: ["markdown", "links"],
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- lib/firecrawl/client.test.ts`

Expected: FAIL because `includeLinks` is not accepted and detail calls still request links.

- [ ] **Step 3: Implement the lean Firecrawl call**

```typescript
export async function firecrawlScrape(
  url: string,
  options: { includeLinks?: boolean } = {},
): Promise<{ markdown: string; links: string[] }> {
  const formats = options.includeLinks ? ["markdown", "links"] : ["markdown"];
  const json = await firecrawlPost<{ data: { markdown?: string; links?: string[] } }>(
    "/scrape",
    { url, formats, onlyMainContent: true },
  );
  return { markdown: json.data.markdown ?? "", links: json.data.links ?? [] };
}
```

- [ ] **Step 4: Change the adapter contract**

```typescript
// lib/sync/sources/types.ts
import type { ListingSource } from "@/lib/listings/types";

export type DiscoveredListing = { sourceId: string; url: string };

export type SourceAdapter = {
  source: ListingSource;
  discover(): Promise<DiscoveredListing[]>;
  fetchDetail(url: string): Promise<RawListing | null>;
};
```

Change `plan.ts` to import `DiscoveredListing` from `./sources/types` and export the type
from `lib/sync/sources/index.ts`.

- [ ] **Step 5: Refactor Coworker**

Keep parser functions unchanged. Rename `discoverDetailUrls()` to `discover()` and return:

```typescript
return [...seen].map((url) => ({ sourceId: slugFromUrl(url)!, url }));
```

Every list-page call becomes `firecrawlScrape(listUrl, { includeLinks: true })`.
The adapter becomes:

```typescript
export const coworkerAdapter: SourceAdapter = {
  source: "coworker",
  discover,
  async fetchDetail(url) {
    const { markdown } = await firecrawlScrape(url);
    return parseCoworkerDetail(markdown, url);
  },
};
```

- [ ] **Step 6: Refactor myHQ**

Keep its current discovery scope unchanged (the known locality-hop gap is out of scope).
Change both seed/index scrapes to `{ includeLinks: true }`, then:

```typescript
async function discover(): Promise<DiscoveredListing[]> {
  const [mapped, indexPage] = await Promise.all([
    firecrawlMap(MYHQ_SEED_URL),
    firecrawlScrape(MYHQ_SEED_URL, { includeLinks: true }),
  ]);
  return extractMyhqDetailUrls([
    ...mapped, ...extractLinksFromMarkdown(indexPage.markdown), ...indexPage.links,
  ]).map((url) => ({ sourceId: slugFromUrl(url)!, url }));
}

export const myhqAdapter: SourceAdapter = {
  source: "myhq",
  discover,
  async fetchDetail(url) {
    const { markdown } = await firecrawlScrape(url);
    return parseMyhqDetail(markdown, url);
  },
};
```

- [ ] **Step 7: Refactor CoFynd**

Use the same explicit structure, with `slugFromUrl`:

```typescript
async function discover(): Promise<DiscoveredListing[]> {
  const [mapped, indexPage] = await Promise.all([
    firecrawlMap(COFYND_INDEX_URL),
    firecrawlScrape(COFYND_INDEX_URL, { includeLinks: true }),
  ]);
  return extractCofyndDetailUrls([
    ...mapped, ...extractLinksFromMarkdown(indexPage.markdown), ...indexPage.links,
  ]).map((url) => ({ sourceId: slugFromUrl(url)!, url }));
}

export const cofyndAdapter: SourceAdapter = {
  source: "cofynd",
  discover,
  async fetchDetail(url) {
    const { markdown } = await firecrawlScrape(url);
    return parseCofyndDetail(markdown, url);
  },
};
```

- [ ] **Step 8: Refactor GoFloaters with bounded locality scrapes**

```typescript
async function discover(): Promise<DiscoveredListing[]> {
  const mapped = await firecrawlMap(GOFLOATERS_INDEX_URL);
  const localityUrls = mapped.filter(isGoFloatersLocalityUrl);
  const linkSets = [...mapped];
  const pages = await mapSettledWithConcurrency(
    [GOFLOATERS_INDEX_URL, ...localityUrls],
    3,
    (url) => firecrawlScrape(url, { includeLinks: true }),
  );
  for (const page of pages) {
    if (page.status === "fulfilled") {
      linkSets.push(...page.value.links, ...extractLinksFromMarkdown(page.value.markdown));
    }
  }
  return extractGoFloatersDetailUrls(linkSets).map((url) => ({
    sourceId: sourceIdFromGoFloatersUrl(url)!,
    url,
  }));
}

export const gofloatersAdapter: SourceAdapter = {
  source: "gofloaters",
  discover,
  async fetchDetail(url) {
    const { markdown } = await firecrawlScrape(url);
    return parseGoFloatersDetail(markdown, url);
  },
};
```

- [ ] **Step 9: Rewrite adapter tests**

For each source, replace `describe("<source>Adapter.fetchAll")` with two focused tests:

```typescript
it("discovers canonical source ids without scraping detail pages", async () => {
  // Preserve the existing discovery mocks.
  const discovered = await adapter.discover();
  expect(discovered).toEqual([
    { sourceId: "expected-source-id", url: "https://canonical/detail/url" },
  ]);
});

it("fetches and parses one detail page without requesting links", async () => {
  vi.mocked(firecrawlScrape).mockResolvedValue({ markdown: detailFixture, links: [] });
  const parsed = await adapter.fetchDetail("https://canonical/detail/url");
  expect(parsed?.sourceId).toBe("expected-source-id");
  expect(firecrawlScrape).toHaveBeenCalledWith("https://canonical/detail/url");
});
```

Use each test file's existing expected IDs and fixtures; do not alter parser assertions.
Update discovery expectations to include `{ includeLinks: true }`.

- [ ] **Step 10: Run adapter and client tests**

Run:
`npm test -- lib/firecrawl/client.test.ts lib/sync/sources/coworker.test.ts lib/sync/sources/myhq.test.ts lib/sync/sources/cofynd.test.ts lib/sync/sources/gofloaters.test.ts`

Expected: 5 test files pass.

- [ ] **Step 11: Commit**

```bash
git add lib/firecrawl/client.ts lib/firecrawl/client.test.ts lib/sync/sources \
  lib/sync/plan.ts
git commit -m "refactor(sync): split listing discovery from detail scraping"
```

---

### Task 5: Implement the per-source incremental orchestrator

**Files:**
- Replace: `lib/sync/run-sync.ts`
- Replace tests: `lib/sync/run-sync.test.ts`
- Modify: `scripts/run-listings-sync.ts:6-13`

**Interfaces:**
- Consumes: Tasks 1–4
- Produces: `RunListingsSyncOptions`
- Produces: `runListingsSync(options?)`
- Produces: per-source `SourceSyncOutcome`
- Defers downstream work to Task 6 via `embedListingsMissingEmbedding()` and
  `syncListingGraph()`; mock temporary placeholders in RED tests until Task 6.

- [ ] **Step 1: Write failing orchestrator tests**

Replace the full-replace mocks with:

```typescript
vi.mock("../db/listings", () => ({
  applySourceSync: vi.fn(),
  countVisibleListings: vi.fn(),
  listExistingForSource: vi.fn(),
}));
```

Use adapters with separate mocked methods:

```typescript
const coworker = {
  source: "coworker" as const,
  discover: vi.fn(),
  fetchDetail: vi.fn(),
};
const cofynd = {
  source: "cofynd" as const,
  discover: vi.fn(),
  fetchDetail: vi.fn(),
};
```

Add these tests:

```typescript
it("upserts one successful source while leaving a failed source untouched", async () => {
  coworker.discover.mockRejectedValue(new Error("network"));
  cofynd.discover.mockResolvedValue([{ sourceId: "c1", url: "https://cofynd/c1" }]);
  cofynd.fetchDetail.mockResolvedValue(rawListing({ source: "cofynd", sourceId: "c1" }));
  vi.mocked(listExistingForSource).mockResolvedValue([]);
  vi.mocked(applySourceSync).mockResolvedValue({
    inserted: 1, updated: 0, unchanged: 0,
    graphListings: [], newlyHiddenIds: [],
  });
  vi.mocked(countVisibleListings).mockResolvedValue(1);

  const run = await runListingsSync({
    adapters: [coworker, cofynd],
    skipDownstream: true,
    now: new Date("2026-07-30T00:00:00Z"),
  });

  expect(run.status).toBe("success");
  expect(run.sources.coworker?.status).toBe("failed");
  expect(run.sources.cofynd).toMatchObject({ status: "success", scraped: 1, inserted: 1 });
  expect(applySourceSync).toHaveBeenCalledOnce();
});

it("touches a fresh listing without calling Firecrawl detail scrape", async () => {
  cofynd.discover.mockResolvedValue([{ sourceId: "c1", url: "https://cofynd/c1" }]);
  vi.mocked(listExistingForSource).mockResolvedValue([{
    sourceId: "c1", id: "id", slug: "slug",
    syncedAt: new Date("2026-07-29T00:00:00Z"),
    contentHash: "content", embedHash: "embed", missingRuns: 0,
  }]);
  vi.mocked(applySourceSync).mockResolvedValue({
    inserted: 0, updated: 0, unchanged: 0,
    graphListings: [], newlyHiddenIds: [],
  });
  vi.mocked(countVisibleListings).mockResolvedValue(1);

  const run = await runListingsSync({
    adapters: [cofynd],
    skipDownstream: true,
    now: new Date("2026-07-30T00:00:00Z"),
  });

  expect(cofynd.fetchDetail).not.toHaveBeenCalled();
  expect(applySourceSync).toHaveBeenCalledWith(
    expect.objectContaining({ discoveredSourceIds: ["c1"], scraped: [] }),
  );
  expect(run.sources.cofynd?.scraped).toBe(0);
});

it("does not count an empty discovery as a successful missing run", async () => {
  cofynd.discover.mockResolvedValue([]);
  vi.mocked(countVisibleListings).mockResolvedValue(10);
  const run = await runListingsSync({ adapters: [cofynd], skipDownstream: true });
  expect(run.status).toBe("failed");
  expect(applySourceSync).not.toHaveBeenCalled();
  expect(run.sources.cofynd?.error).toMatch(/zero URLs/);
});
```

- [ ] **Step 2: Run orchestrator tests and verify RED**

Run: `npm test -- lib/sync/run-sync.test.ts`

Expected: FAIL because the current orchestrator calls `fetchAll()` and
`fullReplaceListings()`.

- [ ] **Step 3: Implement the orchestrator**

Use this public option surface:

```typescript
export type RunListingsSyncOptions = {
  adapters?: SourceAdapter[];
  maxDetailScrapes?: number;
  trackMissing?: boolean;
  skipDownstream?: boolean;
  now?: Date;
  ttlMs?: number;
};
```

Default adapters are all four production adapters; defaults are
`trackMissing: true`, `skipDownstream: false`, `now: new Date()`, and
`ttlMs: getListingDetailTtlMs()`.

For each adapter:

1. Call `discover()`. Throw a source-local error when it returns zero URLs.
2. Load `listExistingForSource(adapter.source)`.
3. Call `planSourceSync()`.
4. Apply `maxDetailScrapes` to `toScrape` only; discovery still marks all found IDs seen.
5. Call `mapSettledWithConcurrency(planned, 3, item => adapter.fetchDetail(item.url))`.
6. Reject parsed rows whose `source` or `sourceId` does not match discovery.
7. Build each `PreparedListing` with stable existing `id`/`slug` or new UUID/slug:

```typescript
const previous = existingById.get(raw.sourceId);
const listing: Listing = {
  ...raw,
  id: previous?.id ?? crypto.randomUUID(),
  slug: previous?.slug ?? slugifyTitle(raw.title, raw.sourceId),
  syncedAt: now.toISOString(),
};
const prepared: PreparedListing = {
  listing,
  contentHash: contentHash(raw),
  embedHash: embedHash(raw),
  isNew: previous == null,
  previousContentHash: previous?.contentHash ?? null,
  previousEmbedHash: previous?.embedHash ?? null,
  wasHidden: (previous?.missingRuns ?? 0) >= missingLimit,
};
```

8. Call `applySourceSync()` once. Its `discoveredSourceIds` is the complete discovery
   result, including TTL-skipped rows and failed detail scrapes.
9. Store outcome counts and accumulate `graphListings`/`newlyHiddenIds`.

Catch each source independently. An empty discovery and an exception are both failed
outcomes with no call to `applySourceSync()`.

After all sources settle:

- Overall status is `success` when at least one source succeeded; otherwise `failed`.
- Run downstream work only when at least one source succeeded and `skipDownstream` is false.
- Call `countVisibleListings()` for `SyncRun.count`.
- Always call `finishSyncRun(..., sources)`.

The implementation must use `finally`/top-level catch so a database exception after
`startSyncRun()` cannot strand the row at `running`.

- [ ] **Step 4: Keep the cron entrypoint concise**

Change its success log to include source outcomes without dumping errors or secrets:

```typescript
const summary = Object.entries(run.sources)
  .map(([source, result]) => `${source}:${result?.status}`)
  .join(" ");
console.log(`sync ${run.status} count=${run.count ?? 0} ${summary}`);
```

- [ ] **Step 5: Run focused tests**

Run: `npm test -- lib/sync/run-sync.test.ts`

Expected: all orchestrator tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/sync/run-sync.ts lib/sync/run-sync.test.ts scripts/run-listings-sync.ts
git commit -m "feat(sync): orchestrate independent incremental source updates"
```

---

### Task 6: Make embeddings and AGE updates incremental

**Files:**
- Modify: `lib/sync/embed-listings.ts:1-20`
- Create: `lib/sync/embed-listings.test.ts`
- Modify: `lib/graph/age.ts:8-188`
- Modify: `lib/graph/age.test.ts`
- Modify: `lib/graph/rebuild.ts`
- Modify: `lib/graph/rebuild.test.ts`
- Modify: `lib/sync/run-sync.ts` downstream calls
- Modify: `scripts/backfill-embeddings.ts`

**Interfaces:**
- Produces: `embedListingsMissingEmbedding(): Promise<number>`
- Produces: `replaceListingGraph(input)`
- Produces: `syncListingGraph(changed)`
- Consumes: `graphListings` from Task 3/5

- [ ] **Step 1: Write a failing incremental embedding test**

```typescript
// lib/sync/embed-listings.test.ts
import { expect, it, vi } from "vitest";
vi.mock("../db/listings", () => ({
  listListingsMissingEmbedding: vi.fn(),
  updateListingEmbedding: vi.fn(),
}));
vi.mock("../ai/client", () => ({ embedTexts: vi.fn() }));

import { embedTexts } from "../ai/client";
import { listListingsMissingEmbedding, updateListingEmbedding } from "../db/listings";
import { embedListingsMissingEmbedding } from "./embed-listings";

it("embeds only rows whose embedding is null", async () => {
  vi.mocked(listListingsMissingEmbedding).mockResolvedValue([sampleListing]);
  vi.mocked(embedTexts).mockResolvedValue([[0.1, 0.2]]);
  await expect(embedListingsMissingEmbedding()).resolves.toBe(1);
  expect(listListingsMissingEmbedding).toHaveBeenCalledOnce();
  expect(updateListingEmbedding).toHaveBeenCalledWith(sampleListing.id, [0.1, 0.2]);
});
```

Define `sampleListing` with the same complete shape used in `rebuild.test.ts`.

- [ ] **Step 2: Run embedding test and verify RED**

Run: `npm test -- lib/sync/embed-listings.test.ts`

Expected: FAIL because `embedListingsMissingEmbedding` is missing.

- [ ] **Step 3: Implement incremental embedding**

Replace `listListings()` with `listListingsMissingEmbedding()` and rename the function:

```typescript
export async function embedListingsMissingEmbedding(): Promise<number> {
  const listings = await listListingsMissingEmbedding();
  // Keep the existing chunked embedding loop unchanged.
}
```

Update the backfill script and orchestrator import. `embed:backfill` now correctly means
"fill missing embeddings"; it no longer wastes tokens re-embedding valid vectors.

- [ ] **Step 4: Write a failing AGE replacement test**

Add to `lib/graph/age.test.ts`:

```typescript
it("replaces one listing graph atomically", async () => {
  process.env.DATABASE_URL = "postgres://local/test";
  query.mockResolvedValue({ rows: [] });
  await replaceListingGraph({
    id: "listing-1", slug: "space", title: "Space",
    entities: { ...emptyQueryEntities(), amenities: ["wifi"] },
  });
  expect(query).toHaveBeenCalledWith("BEGIN");
  expect(query).toHaveBeenCalledWith(expect.stringContaining("DETACH DELETE l"));
  expect(query).toHaveBeenCalledWith(expect.stringContaining("MERGE (l:Listing"));
  expect(query).toHaveBeenCalledWith("COMMIT");
});

```

- [ ] **Step 5: Implement atomic graph replacement**

Export `ListingInput`. Factor the existing upsert query execution into a helper accepting
a connected client. Implement:

```typescript
export async function replaceListingGraph(input: ListingInput): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const client = await getPool().connect();
  try {
    await ensureAgeSession(client);
    await client.query("BEGIN");
    await client.query(
      `SELECT * FROM cypher('gentle_space', $$
        MATCH (l:Listing {id: ${cypherString(input.id)}}) DETACH DELETE l
      $$) AS (v agtype)`,
    );
    await client.query(
      `SELECT * FROM cypher('gentle_space', $$ ${listingUpsertCypher(input)} $$)
       AS (listing_id agtype)`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

```

- [ ] **Step 6: Extract graph-input preparation and write failing sync tests**

Factor the seed + LLM merge logic in `rebuild.ts` into:

```typescript
async function prepareListingGraphInput(listing: Listing): Promise<ListingInput>
```

Export:

```typescript
export async function syncListingGraph(
  changed: Listing[],
): Promise<{ listings: number; skipped: boolean }>
```

Test:

- unavailable AI/AGE returns skipped and mutates nothing;
- extraction is completed for every changed listing before the first graph mutation;
- changed rows call `replaceListingGraph`;
- soft-hidden rows do not mutate AGE; vector search excludes them before graph scoring;
- `rebuildListingGraph` still wipes once and uses `upsertListingGraph`.

- [ ] **Step 7: Implement incremental graph sync**

```typescript
export async function syncListingGraph(changed: Listing[]) {
  if (!isAiSearchConfigured() || !(await isAgeAvailable())) {
    return { listings: 0, skipped: true };
  }
  const prepared = [];
  for (const listing of changed) {
    prepared.push(await prepareListingGraphInput(listing));
  }
  // Extraction finishes before mutation, so a provider failure leaves the graph untouched.
  for (const input of prepared) await replaceListingGraph(input);
  // ponytail: soft-hidden Listing nodes remain until graph:rebuild; vector search
  // filters them before graph scoring, and retaining them makes reactivation safe.
  return { listings: prepared.length, skipped: false };
}
```

Wire the orchestrator to call `embedListingsMissingEmbedding()` then
`syncListingGraph(graphListings)`, preserving separate soft-fail catches.

- [ ] **Step 8: Run focused tests**

Run:
`npm test -- lib/sync/embed-listings.test.ts lib/graph/age.test.ts lib/graph/rebuild.test.ts lib/sync/run-sync.test.ts`

Expected: 4 test files pass.

- [ ] **Step 9: Commit**

```bash
git add lib/sync/embed-listings.ts lib/sync/embed-listings.test.ts \
  lib/graph/age.ts lib/graph/age.test.ts lib/graph/rebuild.ts \
  lib/graph/rebuild.test.ts lib/sync/run-sync.ts scripts/backfill-embeddings.ts
git commit -m "feat(sync): update embeddings and graph only for changed listings"
```

---

### Task 7: Replace destructive preview and add the live Firecrawl check

**Files:**
- Replace: `scripts/preview-listings-sync.ts`
- Create: `scripts/check-incremental-sync.ts`
- Modify: `package.json:11-15`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: `runListingsSync()` and `cofyndAdapter`
- Produces: `npm run sync:check`
- Live check makes one real detail scrape and then proves the immediate second run makes zero detail scrapes.

- [ ] **Step 1: Replace the preview script**

Delete its custom Coworker scrape/parse/full-replace flow. Use:

```typescript
import { runListingsSync } from "../lib/sync/run-sync";
import { coworkerAdapter } from "../lib/sync/sources";

const maxDetailScrapes = Number(process.env.PREVIEW_MAX_DETAILS ?? "12");

runListingsSync({ adapters: [coworkerAdapter], maxDetailScrapes })
  .then((run) => {
    const result = run.sources.coworker;
    console.log(
      `preview ${run.status} discovered=${result?.discovered ?? 0} ` +
      `scraped=${result?.scraped ?? 0} inserted=${result?.inserted ?? 0} ` +
      `updated=${result?.updated ?? 0}`,
    );
    process.exit(run.status === "success" ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

This retains the cap but no longer deletes any row.

- [ ] **Step 2: Write the live Firecrawl check**

```typescript
// scripts/check-incremental-sync.ts
import assert from "node:assert/strict";
import { runListingsSync } from "../lib/sync/run-sync";
import { cofyndAdapter } from "../lib/sync/sources";

async function main() {
  const discovered = await cofyndAdapter.discover();
  const target = discovered.find((item) => item.sourceId !== "gurugram");
  assert.ok(target, "CoFynd discovery returned no usable listing");

  let detailCalls = 0;
  const oneListingAdapter = {
    ...cofyndAdapter,
    discover: async () => [target],
    fetchDetail: async (url: string) => {
      detailCalls++;
      return cofyndAdapter.fetchDetail(url);
    },
  };

  const first = await runListingsSync({
    adapters: [oneListingAdapter],
    maxDetailScrapes: 1,
    trackMissing: false,
    skipDownstream: true,
    ttlMs: 1,
  });
  assert.equal(first.status, "success");
  assert.equal(first.sources.cofynd?.scraped, 1);
  const afterFirst = detailCalls;

  const second = await runListingsSync({
    adapters: [oneListingAdapter],
    maxDetailScrapes: 1,
    trackMissing: false,
    skipDownstream: true,
  });
  assert.equal(second.status, "success");
  assert.equal(second.sources.cofynd?.scraped, 0);
  assert.equal(detailCalls, afterFirst, "second run unexpectedly scraped a detail page");

  console.log(
    `incremental sync ok: ${target.sourceId}; first scraped=1, immediate second scraped=0`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

`trackMissing: false` ensures this one-listing operational check never increments missing
counters for other CoFynd rows. `skipDownstream: true` prevents Vertex/Gemini usage; unit
tests cover embedding preservation.

- [ ] **Step 3: Add scripts and config documentation**

In `package.json`:

```json
"sync:check": "tsx --env-file=.env.local scripts/check-incremental-sync.ts"
```

In `.env.example`:

```dotenv
LISTING_DETAIL_TTL_DAYS=7
LISTING_MISSING_RUNS_LIMIT=3
```

Update `README.md`:

- `sync:listings` is incremental, not full-replace;
- `sync:preview` is Coworker-only and capped but non-destructive;
- `sync:check` costs one real detail scrape plus CoFynd discovery and writes one listing;
- apply `005_incremental_sync.sql` after `004_age.sql`;
- failed sources do not hide existing rows.

- [ ] **Step 4: Run all unit tests**

Run: `npm test`

Expected: all test files pass.

- [ ] **Step 5: Apply migration to the local database**

The rollback dump already exists at `backup-listings-20260730-084824.sql`.

Run:

```bash
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings \
  < lib/db/migrations/005_incremental_sync.sql
```

Expected: `BEGIN`, `ALTER TABLE`, `UPDATE 10`, `ALTER TABLE`, `CREATE INDEX`, `COMMIT`.

- [ ] **Step 6: Run the live Firecrawl check**

Run: `npm run sync:check`

Expected:

```text
incremental sync ok: <cofynd-source-id>; first scraped=1, immediate second scraped=0
```

Then verify database state:

```bash
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings -c "
SELECT source, count(*) AS rows,
       count(*) FILTER (WHERE embedding IS NOT NULL) AS embedded,
       max(synced_at) AS last_detail_scrape,
       max(last_seen_at) AS last_seen
FROM listings GROUP BY source ORDER BY source;"
```

Expected: the original 10 Coworker rows remain; one CoFynd row exists or is updated.

- [ ] **Step 7: Commit**

```bash
git add scripts/preview-listings-sync.ts scripts/check-incremental-sync.ts \
  package.json package-lock.json .env.example README.md
git commit -m "test(sync): verify incremental behavior with live Firecrawl"
```

---

### Task 8: Integration verification and project-memory update

**Files:**
- Modify: `openmemory.md`
- Modify if self-review found gaps:
  `docs/superpowers/specs/2026-07-30-incremental-listings-sync-design.md`

**Interfaces:**
- Verifies all prior tasks together.
- Does not resume the Render cron.

- [ ] **Step 1: Run the full automated verification**

Run:

```bash
npm test
npx tsc --noEmit
npm run graph:check
```

Expected:

- all Vitest tests pass;
- no newly introduced TypeScript errors (the pre-existing errors in
  `lib/sync/run-sync.test.ts:86` and `lib/sync/sources/gofloaters.ts:180` must be gone
  because these files were rewritten);
- live graph check reports a non-zero Bellandur overlap.

Run `npm run lint`. The repository currently has a pre-existing ESM resolution error for
`eslint-config-next/core-web-vitals`; record it if still present, but do not broaden this
feature into an ESLint configuration repair.

- [ ] **Step 2: Verify webpage reads**

With the existing dev server, or start `npm run dev`, verify:

```bash
curl -fsS http://127.0.0.1:3000/spaces >/dev/null
curl -fsS -X POST http://127.0.0.1:3000/api/spaces/search \
  -H 'content-type: application/json' \
  -d '{"query":"coworking in Bellandur with wifi"}' >/tmp/gentle-space-search.json
```

Expected: `/spaces` is 200; search is 200 with a non-empty `listings` array; no graph
fallback error appears in the server log.

- [ ] **Step 3: Verify idempotency with SQL**

Before and after one `sync:check`, compare:

```sql
SELECT source, source_id, id, slug, synced_at, last_seen_at, missing_runs, embed_hash,
       embedding IS NOT NULL AS embedded
FROM listings
WHERE source = 'cofynd'
ORDER BY source_id;
```

Expected: the checked row keeps the same `id` and `slug`; the second immediate run changes
`last_seen_at` only, not `synced_at`, `embed_hash`, or `embedding`.

- [ ] **Step 4: Update project guide and memory**

Update `openmemory.md`:

- Patterns: per-source incremental upsert, 7-day detail TTL, 3-successful-run soft-hide.
- Components: `plan.ts`, `content-hash.ts`, migration `005_incremental_sync.sql`.
- Ops: `npm run sync:check` performs one live Firecrawl sample and skips AI downstream.
- Remove the claim that sync is full-replace.
- Keep the Render cron intentionally paused.

Store one project implementation memory (project fact, not user preference) summarizing the
schema, TTL, stable IDs/slugs, incremental embeddings/graph, and live check result. Scan it
for secrets first.

- [ ] **Step 5: Final commit**

```bash
git add openmemory.md docs/superpowers/specs/2026-07-30-incremental-listings-sync-design.md
git commit -m "docs: record incremental listings sync operations"
```

Do not push and do not resume the Render cron without an explicit request.
