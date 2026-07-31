# Listing Enrichment (Firecrawl Extract) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the end of every listings sync, batch-enrich weak rows (empty location, city-centroid pins, or unusable price) via Firecrawl `/extract`, confidence-gate writes into live columns, and let existing embed/geocode hooks heal vectors and pins in the same cycle.

**Architecture:** Soft-fail step in `runListingsSync` runs **before** embed/geocode: select weak visible rows → Pass 1 page extract (`enableWebSearch: false`) → confidence gate → Pass 2 web extract for misses only (`enableWebSearch: true`, capped) → gated overwrite of `area`/`address`/`pricing_hint` with lat/lng + structured embedding invalidation → audit rows in `listing_enrichment_log`. Scrape client stays on Firecrawl **v1**; extract uses **v2** async (`POST /v2/extract` → poll `GET /v2/extract/{id}`). Chunk ≤10 URLs per extract job (Firecrawl beta limit).

**Tech Stack:** TypeScript, vitest + mocked `fetch`, Postgres (`public.`-qualified DDL), existing `lib/listings/address.ts` + `lib/sync/sources/price.ts`, Firecrawl Extract v2 (no new npm deps).

## Global Constraints

- Design doc (approved): `docs/superpowers/specs/2026-07-31-listing-enrichment-design.md`.
- Pipeline order: `scrape → upsert → enrich → embed → geocode → graph`.
- Soft-fail enrichment errors; never fail the sync. `ENRICH_DISABLED=1` skips entirely.
- Write live columns only above the moderate confidence floor; provenance via `listing_enrichment_log`, not parallel enrichment columns.
- Schema-qualify `public.` on new DDL (AGE `search_path` puts `ag_catalog` first — same footgun as migration 008).
- City centroid for weak check: `{ lat: 12.9629, lng: 77.5775 }` with `|Δ| < 0.0005` (~50 m), same as `scripts/repair-geocodes.ts`.
- Reject bare city locality (`Bengaluru` / `Bangalore`) even if `looksLikeLocality` would accept it.
- Extract URL batch size: **10** (Firecrawl beta). Pace chunks with `forEachChunkPaced` (chunk 10, ~25 items/min) to avoid bursting credits.
- No new npm dependencies. Run `npx vitest run <paths>` for tests. Commit after each task.
- Prefer **parallel subagents** for Wave A (Tasks 1–3 independent). Then Wave B (4→5), Wave C (6→7). Prefer `superpowers:subagent-driven-development` over serial inline execution.

## File map

| File | Responsibility |
|------|----------------|
| `lib/db/migrations/009_listing_enrichment_log.sql` | Audit table + index |
| `lib/db/schema.sql` | Fresh-install mirror of 009 |
| `lib/sync/enrich-weak.ts` | Pure: city-centroid, weak check, cooldown filter inputs |
| `lib/sync/enrich-gate.ts` | Pure: location/price confidence gate + write mapping |
| `lib/sync/enrich-weak.test.ts` | Weak + centroid unit tests |
| `lib/sync/enrich-gate.test.ts` | Gate + mapping unit tests |
| `lib/firecrawl/client.ts` | Add v2 `firecrawlExtract` (start + poll + chunk normalize) |
| `lib/firecrawl/client.extract.test.ts` | Mocked fetch for extract client |
| `lib/db/listings.ts` | `listEnrichmentCandidates`, `applyListingEnrichment`, `insertEnrichmentLog`, `listRecentlyAcceptedEnrichmentIds` |
| `lib/db/listings-enrichment.test.ts` | SQL shape tests with mocked pool |
| `lib/sync/enrich-listings.ts` | Orchestrator: Pass 1/2, gate, write, log |
| `lib/sync/enrich-listings.test.ts` | Orchestrator tests with mocked Firecrawl + DB |
| `lib/sync/run-sync.ts` | Call enrich before embed; soft-fail |
| `lib/sync/run-sync.test.ts` | Soft-fail + ordering assertions |
| `scripts/enrich-listings.ts` | Manual / dry-run CLI |
| `package.json` | `enrich:listings` script |
| `README.md` | Migration line + env knobs |

## Parallel execution waves

```
Wave A (parallel):  Task 1 ‖ Task 2 ‖ Task 3
Wave B (serial):    Task 4 → Task 5
Wave C (serial):    Task 6 → Task 7
```

---

### Task 1: Migration + schema + README

**Files:**
- Create: `lib/db/migrations/009_listing_enrichment_log.sql`
- Modify: `lib/db/schema.sql`
- Modify: `README.md` (migration block after `008` / `007` as present)

**Interfaces:**
- Produces: `public.listing_enrichment_log` with columns `(id, listing_id, pass, accepted, payload, created_at)` and index `(listing_id, created_at DESC)`

- [ ] **Step 1: Write the migration**

Create `lib/db/migrations/009_listing_enrichment_log.sql`:

```sql
BEGIN;

-- Schema-qualified on purpose: the deployed role has search_path
-- "ag_catalog, $user, public" for Apache AGE, so an unqualified CREATE TABLE
-- lands this app table inside the extension's schema.
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

COMMIT;
```

- [ ] **Step 2: Apply locally and verify**

```bash
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings < lib/db/migrations/009_listing_enrichment_log.sql
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings -c "\d public.listing_enrichment_log"
```

Expected: table listed with `pass`, `accepted`, `payload`, FK to `listings`.

- [ ] **Step 3: Mirror in `lib/db/schema.sql`**

After the `search_queries` index block, append the same `CREATE TABLE` + index (may omit `public.` in schema.sql to match existing style for `search_queries`, but keep the migration schema-qualified).

- [ ] **Step 4: Document in README**

After the latest migration line in the apply-schema block, add:

```bash
docker exec -i gentle-space-pg psql -U gentle -d gentle_space_listings < lib/db/migrations/009_listing_enrichment_log.sql
```

- [ ] **Step 5: Commit**

```bash
git add lib/db/migrations/009_listing_enrichment_log.sql lib/db/schema.sql README.md
git commit -m "$(cat <<'EOF'
feat(db): add listing_enrichment_log audit table

EOF
)"
```

---

### Task 2: Pure weak-row + confidence-gate helpers

**Files:**
- Create: `lib/sync/enrich-weak.ts`
- Create: `lib/sync/enrich-gate.ts`
- Create: `lib/sync/enrich-weak.test.ts`
- Create: `lib/sync/enrich-gate.test.ts`

**Interfaces:**
- Produces:
  - `BANGALORE_CITY_CENTROID = { lat: 12.9629, lng: 77.5775 }`
  - `isAtCityCentroid(lat: number | null, lng: number | null): boolean`
  - `isWeakListing(row: EnrichCandidate): boolean`
  - `isPricingWeak(pricingHint: string | null | undefined): boolean`
  - `normalizeLocalityKey(locality: string): string` (trim + lower-case collapse)
  - `ExtractResult` type matching the extract schema fields
  - `gateLocation(result, opts?: { pass2Locality?: string | null }): { accept: boolean; area: string; address: string }`
  - `gatePrice(result, currentHint: string | null): { accept: boolean; pricingHint: string } | { accept: false }`
  - `EnrichCandidate`: `{ id, title, sourceUrl, area, address, pricingHint, lat, lng, syncedAt }`

- [ ] **Step 1: Write failing weak/centroid tests**

Create `lib/sync/enrich-weak.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isAtCityCentroid,
  isPricingWeak,
  isWeakListing,
} from "./enrich-weak";

const base = {
  id: "a",
  title: "WeWork",
  sourceUrl: "https://example.com/x",
  area: "HSR Layout",
  address: "1 Main, Bengaluru",
  pricingHint: "₹20,000/month",
  lat: 12.91,
  lng: 77.64,
  syncedAt: "2026-07-31T00:00:00.000Z",
};

describe("isAtCityCentroid", () => {
  it("matches the Bangalore city centroid within ~50 m", () => {
    expect(isAtCityCentroid(12.9629, 77.5775)).toBe(true);
    expect(isAtCityCentroid(12.9629 + 0.0004, 77.5775)).toBe(true);
    expect(isAtCityCentroid(12.91, 77.64)).toBe(false);
    expect(isAtCityCentroid(null, 77.5775)).toBe(false);
  });
});

describe("isWeakListing", () => {
  it("includes empty area+address", () => {
    expect(isWeakListing({ ...base, area: "", address: "  " })).toBe(true);
  });

  it("includes city-centroid coords even with a locality", () => {
    expect(isWeakListing({ ...base, lat: 12.9629, lng: 77.5775 })).toBe(true);
  });

  it("includes unparseable / non-monthly price", () => {
    expect(isWeakListing({ ...base, pricingHint: "Price on request" })).toBe(true);
    expect(isWeakListing({ ...base, pricingHint: "₹17,999/year" })).toBe(true);
  });

  it("excludes a healthy row", () => {
    expect(isWeakListing(base)).toBe(false);
  });
});

describe("isPricingWeak", () => {
  it("treats empty, unparseable, and non-monthly as weak", () => {
    expect(isPricingWeak(null)).toBe(true);
    expect(isPricingWeak("")).toBe(true);
    expect(isPricingWeak("ask")).toBe(true);
    expect(isPricingWeak("₹600/day")).toBe(false); // convertible monthly
    expect(isPricingWeak("₹20,000/month")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run lib/sync/enrich-weak.test.ts
```

Expected: FAIL (module not found / exports missing).

- [ ] **Step 3: Implement `enrich-weak.ts`**

```ts
import { parseStoredPrice } from "./sources/price";

export const BANGALORE_CITY_CENTROID = { lat: 12.9629, lng: 77.5775 } as const;
const CENTROID_EPS = 0.0005;

export type EnrichCandidate = {
  id: string;
  title: string;
  sourceUrl: string;
  area: string;
  address: string;
  pricingHint: string | null;
  lat: number | null;
  lng: number | null;
  syncedAt: string;
};

export function isAtCityCentroid(lat: number | null, lng: number | null): boolean {
  if (lat == null || lng == null) return false;
  return (
    Math.abs(lat - BANGALORE_CITY_CENTROID.lat) < CENTROID_EPS &&
    Math.abs(lng - BANGALORE_CITY_CENTROID.lng) < CENTROID_EPS
  );
}

export function isPricingWeak(pricingHint: string | null | undefined): boolean {
  const parsed = parseStoredPrice(pricingHint);
  return parsed == null || parsed.monthlyInr == null;
}

export function isWeakListing(row: EnrichCandidate): boolean {
  const emptyLoc = row.area.trim() === "" && row.address.trim() === "";
  return emptyLoc || isAtCityCentroid(row.lat, row.lng) || isPricingWeak(row.pricingHint);
}
```

- [ ] **Step 4: Re-run weak tests — expect PASS**

```bash
npx vitest run lib/sync/enrich-weak.test.ts
```

- [ ] **Step 5: Write failing gate tests**

Create `lib/sync/enrich-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { gateLocation, gatePrice, normalizeLocalityKey, type ExtractResult } from "./enrich-gate";

const medium: ExtractResult = {
  locality: "HSR Layout",
  address: null,
  monthly_price_inr: 20000,
  price_basis: "exact",
  brand_match: true,
  confidence: "medium",
  evidence: "Pricing Plans section",
};

describe("gateLocation", () => {
  it("accepts medium+ locality that looksLikeLocality", () => {
    const g = gateLocation(medium);
    expect(g.accept).toBe(true);
    if (g.accept) expect(g.area).toBe("HSR Layout");
  });

  it("rejects bare city and junk locality", () => {
    expect(gateLocation({ ...medium, locality: "Bengaluru" }).accept).toBe(false);
    expect(gateLocation({ ...medium, locality: "2nd Floor" }).accept).toBe(false);
  });

  it("rejects low confidence unless Pass1≈Pass2 locality", () => {
    expect(gateLocation({ ...medium, confidence: "low" }).accept).toBe(false);
    expect(
      gateLocation(
        { ...medium, confidence: "low", locality: "Whitefield" },
        { pass2Locality: "whitefield" },
      ).accept,
    ).toBe(true);
  });

  it("prefers full postal address when hasCityMarker", () => {
    const g = gateLocation({
      ...medium,
      address: "27th Main, HSR Layout, Bengaluru, Karnataka 560102, India",
    });
    expect(g.accept).toBe(true);
    if (g.accept) {
      expect(g.address).toContain("Bengaluru");
      expect(g.area).toBe("HSR Layout"); // localityFromAddress or locality field
    }
  });
});

describe("gatePrice", () => {
  it("accepts medium+ monthly and formats via formatPricingHint", () => {
    const g = gatePrice(medium, "Price on request");
    expect(g.accept).toBe(true);
    if (g.accept) expect(g.pricingHint).toBe("₹20,000/month");
  });

  it("prefixes from when price_basis is from", () => {
    const g = gatePrice({ ...medium, price_basis: "from" }, null);
    expect(g.accept).toBe(true);
    if (g.accept) expect(g.pricingHint).toMatch(/^from ₹/);
  });

  it("does not overwrite a usable existing price", () => {
    expect(gatePrice(medium, "₹15,000/month").accept).toBe(false);
  });

  it("rejects low confidence price", () => {
    expect(gatePrice({ ...medium, confidence: "low" }, null).accept).toBe(false);
  });
});

describe("normalizeLocalityKey", () => {
  it("collapses case and whitespace", () => {
    expect(normalizeLocalityKey("  HSR Layout ")).toBe("hsr layout");
  });
});
```

- [ ] **Step 6: Run gate tests — expect FAIL**

```bash
npx vitest run lib/sync/enrich-gate.test.ts
```

- [ ] **Step 7: Implement `enrich-gate.ts`**

```ts
import {
  hasCityMarker,
  localityFromAddress,
  looksLikeLocality,
} from "../listings/address";
import { formatPricingHint, parseStoredPrice } from "./sources/price";
import { isPricingWeak } from "./enrich-weak";

export type ExtractConfidence = "high" | "medium" | "low";
export type ExtractResult = {
  locality: string | null;
  address: string | null;
  monthly_price_inr: number | null;
  price_basis: "exact" | "from" | null;
  brand_match: boolean;
  confidence: ExtractConfidence;
  evidence: string | null;
};

const BARE_CITY = /^(?:Bengaluru|Bangalore)$/i;

export function normalizeLocalityKey(locality: string): string {
  return locality.trim().toLowerCase().replace(/\s+/g, " ");
}

export function gateLocation(
  result: ExtractResult,
  opts: { pass2Locality?: string | null } = {},
): { accept: true; area: string; address: string } | { accept: false } {
  const rawAddress = result.address?.trim() || "";
  const fromAddress = rawAddress && hasCityMarker(rawAddress) ? localityFromAddress(rawAddress) : "";
  const locality = (result.locality ?? "").trim() || fromAddress;
  if (!locality || BARE_CITY.test(locality) || !looksLikeLocality(locality)) {
    return { accept: false };
  }

  const agreed =
    opts.pass2Locality != null &&
    normalizeLocalityKey(opts.pass2Locality) === normalizeLocalityKey(locality);
  const confidenceOk = result.confidence === "high" || result.confidence === "medium" || agreed;
  if (!confidenceOk) return { accept: false };

  if (rawAddress && hasCityMarker(rawAddress)) {
    return { accept: true, area: fromAddress || locality, address: rawAddress };
  }
  return { accept: true, area: locality, address: "" };
}

export function gatePrice(
  result: ExtractResult,
  currentHint: string | null,
): { accept: true; pricingHint: string } | { accept: false } {
  if (!isPricingWeak(currentHint)) return { accept: false };
  if (result.monthly_price_inr == null) return { accept: false };
  if (result.confidence !== "high" && result.confidence !== "medium") return { accept: false };

  const formatted = formatPricingHint(String(result.monthly_price_inr), "month");
  if (!formatted) return { accept: false };
  const pricingHint = result.price_basis === "from" ? `from ${formatted}` : formatted;
  const parsed = parseStoredPrice(pricingHint);
  if (parsed == null || parsed.monthlyInr == null) return { accept: false };
  return { accept: true, pricingHint };
}
```

- [ ] **Step 8: Re-run gate tests — expect PASS**

```bash
npx vitest run lib/sync/enrich-gate.test.ts lib/sync/enrich-weak.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add lib/sync/enrich-weak.ts lib/sync/enrich-gate.ts lib/sync/enrich-weak.test.ts lib/sync/enrich-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(sync): add pure weak-row and enrichment confidence gates

EOF
)"
```

---

### Task 3: Firecrawl v2 `firecrawlExtract` client

**Files:**
- Modify: `lib/firecrawl/client.ts`
- Create: `lib/firecrawl/client.extract.test.ts`

**Interfaces:**
- Produces:
  - `EXTRACT_SCHEMA` (JSON Schema object for the extract fields)
  - `EXTRACT_PROMPT` (Bangalore-only constraints from the design)
  - `firecrawlExtract(urls: string[], options: { prompt?: string; schema?: object; enableWebSearch?: boolean; allowExternalLinks?: boolean; pollMs?: number; timeoutMs?: number }): Promise<Map<string, ExtractResult>>`
- Consumes: `ExtractResult` from `lib/sync/enrich-gate.ts` (or duplicate a minimal wire type in the firecrawl module and cast at the boundary — prefer importing the type from enrich-gate)
- Keeps `FIRECRAWL_BASE` v1 for scrape/map; extract uses `https://api.firecrawl.dev/v2`
- Chunks `urls` into batches of 10; for each batch POSTs extract, polls until `completed`/`failed`/`cancelled` or timeout
- Response normalization: prefer `data.listings[]` entries keyed by `source_url`; if single URL and flat object, map that URL → object; drop malformed rows

- [ ] **Step 1: Write failing client tests**

Create `lib/firecrawl/client.extract.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { firecrawlExtract } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("firecrawlExtract", () => {
  it("POSTs /v2/extract then polls until completed and maps by URL", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-test";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v2/extract") && init?.method === "POST") {
        return new Response(JSON.stringify({ success: true, id: "job-1" }), { status: 200 });
      }
      if (url.endsWith("/v2/extract/job-1")) {
        return new Response(
          JSON.stringify({
            success: true,
            status: "completed",
            data: {
              listings: [
                {
                  source_url: "https://ex.com/a",
                  locality: "HSR Layout",
                  address: null,
                  monthly_price_inr: 20000,
                  price_basis: "exact",
                  brand_match: true,
                  confidence: "medium",
                  evidence: null,
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const map = await firecrawlExtract(["https://ex.com/a"], {
      enableWebSearch: false,
      pollMs: 1,
      timeoutMs: 1000,
    });
    expect(map.get("https://ex.com/a")?.locality).toBe("HSR Layout");
    expect(fetchMock.mock.calls[0]?.[0]).toEqual("https://api.firecrawl.dev/v2/extract");
  });

  it("maps a single-URL flat data object to that URL", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v2/extract") && init?.method === "POST") {
          return new Response(JSON.stringify({ success: true, id: "job-2" }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            success: true,
            status: "completed",
            data: {
              locality: "Indiranagar",
              address: null,
              monthly_price_inr: null,
              price_basis: null,
              brand_match: true,
              confidence: "high",
              evidence: null,
            },
          }),
          { status: 200 },
        );
      }),
    );

    const map = await firecrawlExtract(["https://ex.com/b"], { pollMs: 1, timeoutMs: 1000 });
    expect(map.get("https://ex.com/b")?.locality).toBe("Indiranagar");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run lib/firecrawl/client.extract.test.ts
```

- [ ] **Step 3: Implement `firecrawlExtract` in `lib/firecrawl/client.ts`**

Add (keep existing scrape/map on v1):

```ts
import type { ExtractResult } from "../sync/enrich-gate";

const FIRECRAWL_V2_BASE = "https://api.firecrawl.dev/v2";
const EXTRACT_URL_BATCH = 10;

export const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    listings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source_url: { type: "string" },
          locality: { type: ["string", "null"] },
          address: { type: ["string", "null"] },
          monthly_price_inr: { type: ["number", "null"] },
          price_basis: { type: ["string", "null"], enum: ["exact", "from", null] },
          brand_match: { type: "boolean" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          evidence: { type: ["string", "null"] },
        },
        required: ["source_url", "confidence"],
      },
    },
  },
} as const;

export const EXTRACT_PROMPT = `Extract coworking listing location and monthly desk price for Bangalore/Bengaluru only.
For EACH provided URL, return one object in listings[] with the exact source_url.
locality must be a neighbourhood name (not floor, door, landmark phrase, or bare city).
Prefer monthly desk/seat rates; leave price null rather than invent a unit.
brand_match true only when the page clearly refers to this listing's title/brand.
Prefer null over a guess.`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function asExtractResult(raw: unknown): ExtractResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const confidence = o.confidence;
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") return null;
  return {
    locality: typeof o.locality === "string" ? o.locality : null,
    address: typeof o.address === "string" ? o.address : null,
    monthly_price_inr: typeof o.monthly_price_inr === "number" ? o.monthly_price_inr : null,
    price_basis: o.price_basis === "exact" || o.price_basis === "from" ? o.price_basis : null,
    brand_match: Boolean(o.brand_match),
    confidence,
    evidence: typeof o.evidence === "string" ? o.evidence : null,
  };
}

function normalizeExtractData(data: unknown, urls: string[]): Map<string, ExtractResult> {
  const out = new Map<string, ExtractResult>();
  if (!data || typeof data !== "object") return out;
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.listings)) {
    for (const row of obj.listings) {
      if (!row || typeof row !== "object") continue;
      const sourceUrl = (row as { source_url?: unknown }).source_url;
      const parsed = asExtractResult(row);
      if (typeof sourceUrl === "string" && parsed) out.set(sourceUrl, parsed);
    }
    return out;
  }
  if (urls.length === 1) {
    const parsed = asExtractResult(data);
    if (parsed) out.set(urls[0]!, parsed);
  }
  return out;
}

async function firecrawlExtractOnce(
  urls: string[],
  options: {
    prompt: string;
    schema: object;
    enableWebSearch: boolean;
    allowExternalLinks: boolean;
    pollMs: number;
    timeoutMs: number;
  },
): Promise<Map<string, ExtractResult>> {
  const startRes = await fetch(`${FIRECRAWL_V2_BASE}/extract`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      urls,
      prompt: options.prompt,
      schema: options.schema,
      enableWebSearch: options.enableWebSearch,
      allowExternalLinks: options.allowExternalLinks,
      ignoreInvalidURLs: true,
    }),
  });
  const startJson = (await startRes.json()) as { success?: boolean; id?: string; error?: string };
  if (!startRes.ok || !startJson.success || !startJson.id) {
    throw new Error(startJson.error ?? `Firecrawl extract start failed (${startRes.status})`);
  }

  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const statusRes = await fetch(`${FIRECRAWL_V2_BASE}/extract/${startJson.id}`, {
      headers: { Authorization: `Bearer ${getApiKey()}` },
    });
    const statusJson = (await statusRes.json()) as {
      success?: boolean;
      status?: string;
      data?: unknown;
      error?: string;
    };
    if (!statusRes.ok) {
      throw new Error(statusJson.error ?? `Firecrawl extract poll failed (${statusRes.status})`);
    }
    if (statusJson.status === "completed") {
      return normalizeExtractData(statusJson.data, urls);
    }
    if (statusJson.status === "failed" || statusJson.status === "cancelled") {
      throw new Error(statusJson.error ?? `Firecrawl extract ${statusJson.status}`);
    }
    await sleep(options.pollMs);
  }
  throw new Error(`Firecrawl extract timed out after ${options.timeoutMs}ms`);
}

export async function firecrawlExtract(
  urls: string[],
  options: {
    prompt?: string;
    schema?: object;
    enableWebSearch?: boolean;
    allowExternalLinks?: boolean;
    pollMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<Map<string, ExtractResult>> {
  const unique = [...new Set(urls.filter(Boolean))];
  const merged = new Map<string, ExtractResult>();
  const prompt = options.prompt ?? EXTRACT_PROMPT;
  const schema = options.schema ?? EXTRACT_SCHEMA;
  const enableWebSearch = options.enableWebSearch ?? false;
  const allowExternalLinks = options.allowExternalLinks ?? enableWebSearch;
  const pollMs = options.pollMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 180_000;

  for (let i = 0; i < unique.length; i += EXTRACT_URL_BATCH) {
    const chunk = unique.slice(i, i + EXTRACT_URL_BATCH);
    const part = await firecrawlExtractOnce(chunk, {
      prompt,
      schema,
      enableWebSearch,
      allowExternalLinks,
      pollMs,
      timeoutMs,
    });
    for (const [k, v] of part) merged.set(k, v);
  }
  return merged;
}
```

- [ ] **Step 4: Re-run — expect PASS**

```bash
npx vitest run lib/firecrawl/client.extract.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/firecrawl/client.ts lib/firecrawl/client.extract.test.ts
git commit -m "$(cat <<'EOF'
feat(firecrawl): add async v2 extract client with URL batching

EOF
)"
```

---

### Task 4: DB helpers for enrichment candidates + write-back + log

**Files:**
- Modify: `lib/db/listings.ts`
- Create: `lib/db/listings-enrichment.test.ts`

**Interfaces:**
- Produces:
  - `listEnrichmentCandidates(): Promise<EnrichCandidate[]>` — visible rows (`missing_runs < limit`), columns needed for weak check
  - `listRecentlyAcceptedEnrichmentIds(cooldownDays: number): Promise<Map<string, string>>` — listing_id → ISO `created_at` of latest accepted log within window
  - `applyListingEnrichment(id, patch: { area?: string; address?: string; pricingHint?: string; locationChanged: boolean; priceChanged: boolean }): Promise<void>`
  - `insertEnrichmentLog(row: { listingId: string; pass: 'page' | 'web'; accepted: boolean; payload: unknown }): Promise<void>`
- Location change → `lat`/`lng` NULL + `structured_embedding` NULL + `embed_hash` NULL
- Price-only change → clear `structured_embedding` + `embed_hash` (pricingHint is in structured embed text); do **not** clear coords

- [ ] **Step 1: Write failing SQL-shape tests**

Create `lib/db/listings-enrichment.test.ts` following the mock-pool pattern in `lib/db/listings-entities.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  getPool: vi.fn(),
}));

import { getPool } from "./client";
import {
  applyListingEnrichment,
  insertEnrichmentLog,
  listEnrichmentCandidates,
  listRecentlyAcceptedEnrichmentIds,
} from "./listings";

const query = vi.fn();

beforeEach(() => {
  query.mockReset();
  vi.mocked(getPool).mockReturnValue({ query } as never);
});

describe("listEnrichmentCandidates", () => {
  it("selects visible listing fields for weak checks", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listEnrichmentCandidates();
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("FROM listings");
    expect(sql).toContain("missing_runs <");
    expect(sql).toMatch(/source_url/i);
  });
});

describe("listRecentlyAcceptedEnrichmentIds", () => {
  it("reads accepted enrichment log rows inside the cooldown window", async () => {
    query.mockResolvedValueOnce({ rows: [{ listing_id: "a", created_at: new Date("2026-07-30") }] });
    const map = await listRecentlyAcceptedEnrichmentIds(7);
    expect(map.get("a")).toBe("2026-07-30T00:00:00.000Z");
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("listing_enrichment_log");
    expect(sql).toContain("accepted = true");
  });
});

describe("applyListingEnrichment", () => {
  it("nulls coords and structured embedding when location changes", async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });
    await applyListingEnrichment("abc", {
      area: "HSR Layout",
      address: "",
      locationChanged: true,
      priceChanged: false,
    });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("lat = NULL");
    expect(sql).toContain("lng = NULL");
    expect(sql).toContain("structured_embedding = NULL");
    expect(sql).toContain("embed_hash = NULL");
  });

  it("clears embeddings but not coords on price-only change", async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });
    await applyListingEnrichment("abc", {
      pricingHint: "₹20,000/month",
      locationChanged: false,
      priceChanged: true,
    });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("pricing_hint");
    expect(sql).toContain("structured_embedding = NULL");
    expect(sql).not.toContain("lat = NULL");
  });
});

describe("insertEnrichmentLog", () => {
  it("inserts into public.listing_enrichment_log", async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });
    await insertEnrichmentLog({
      listingId: "abc",
      pass: "page",
      accepted: true,
      payload: { locality: "HSR Layout" },
    });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("listing_enrichment_log");
    expect(query.mock.calls[0][1][0]).toBe("abc");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run lib/db/listings-enrichment.test.ts
```

- [ ] **Step 3: Implement the four exports in `lib/db/listings.ts`**

```ts
import type { EnrichCandidate } from "../sync/enrich-weak";

export async function listEnrichmentCandidates(): Promise<EnrichCandidate[]> {
  if (!process.env.DATABASE_URL) return [];
  const { rows } = await getPool().query<{
    id: string;
    title: string;
    source_url: string;
    area: string;
    address: string;
    pricing_hint: string | null;
    lat: number | null;
    lng: number | null;
    synced_at: Date;
  }>(
    `SELECT id, title, source_url, area, address, pricing_hint, lat, lng, synced_at
     FROM listings
     WHERE missing_runs < $1
     ORDER BY synced_at DESC`,
    [getListingMissingRunsLimit()],
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    sourceUrl: row.source_url,
    area: row.area ?? "",
    address: row.address ?? "",
    pricingHint: row.pricing_hint,
    lat: row.lat,
    lng: row.lng,
    syncedAt: row.synced_at.toISOString(),
  }));
}

export async function listRecentlyAcceptedEnrichmentIds(
  cooldownDays: number,
): Promise<Map<string, string>> {
  if (!process.env.DATABASE_URL) return new Map();
  const { rows } = await getPool().query<{ listing_id: string; created_at: Date }>(
    `SELECT DISTINCT ON (listing_id) listing_id, created_at
     FROM public.listing_enrichment_log
     WHERE accepted = true
       AND created_at >= now() - ($1::text || ' days')::interval
     ORDER BY listing_id, created_at DESC`,
    [String(cooldownDays)],
  );
  return new Map(rows.map((r) => [r.listing_id, r.created_at.toISOString()]));
}

export async function applyListingEnrichment(
  id: string,
  patch: {
    area?: string;
    address?: string;
    pricingHint?: string;
    locationChanged: boolean;
    priceChanged: boolean;
  },
): Promise<void> {
  const clearEmbed = patch.locationChanged || patch.priceChanged;
  await getPool().query(
    `UPDATE listings SET
       area = COALESCE($2, area),
       address = COALESCE($3, address),
       pricing_hint = COALESCE($4, pricing_hint),
       lat = CASE WHEN $5 THEN NULL ELSE lat END,
       lng = CASE WHEN $5 THEN NULL ELSE lng END,
       structured_embedding = CASE WHEN $6 THEN NULL ELSE structured_embedding END,
       embed_hash = CASE WHEN $6 THEN NULL ELSE embed_hash END
     WHERE id = $1`,
    [
      id,
      patch.area ?? null,
      patch.address ?? null,
      patch.pricingHint ?? null,
      patch.locationChanged,
      clearEmbed,
    ],
  );
}

export async function insertEnrichmentLog(row: {
  listingId: string;
  pass: "page" | "web";
  accepted: boolean;
  payload: unknown;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO public.listing_enrichment_log (listing_id, pass, accepted, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [row.listingId, row.pass, row.accepted, JSON.stringify(row.payload ?? {})],
  );
}
```

Note: `COALESCE($2, area)` means "omit field when null". Callers must pass `undefined` fields as SQL null only when not updating — for location accepts always pass both `area` and `address` strings (address may be `""`). Prefer explicit branches if COALESCE-on-empty-string is wrong for address clears; empty string is a valid write.

Safer variant for the implementer: build SET clauses dynamically from defined keys (still one parameterized query). Tests only assert SQL contains the right NULL assignments.

- [ ] **Step 4: Re-run — expect PASS**

```bash
npx vitest run lib/db/listings-enrichment.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/db/listings.ts lib/db/listings-enrichment.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add enrichment candidate select, write-back, and audit log helpers

EOF
)"
```

---

### Task 5: `enrichListings` orchestrator

**Files:**
- Create: `lib/sync/enrich-listings.ts`
- Create: `lib/sync/enrich-listings.test.ts`

**Interfaces:**
- Produces: `enrichListings(options?: { dryRun?: boolean; webLimit?: number; cooldownDays?: number }): Promise<{ scanned: number; queued: number; pageAccepted: number; webAccepted: number; skippedCooldown: number }>`
- Env: `ENRICH_DISABLED=1` → no-op zeros; `ENRICH_WEB_LIMIT` default 100; `ENRICH_COOLDOWN_DAYS` default 7
- Flow:
  1. Load candidates → filter `isWeakListing`
  2. Load recent accepts; skip if `acceptedAt >= syncedAt` (still within cooldown window map) — i.e. skip when last accept is **after or equal** last scrape so a content-changing scrape (`synced_at` newer) re-queues
  3. Pass 1: `firecrawlExtract(urls, { enableWebSearch: false })`
  4. Gate + write accepted fields; log every attempted URL (accepted true/false) with pass `'page'`
  5. Misses (location still needed or price still weak after pass 1 writes in memory): Pass 2 capped by webLimit with `enableWebSearch: true`
  6. For Pass 2 location: pass `pass2Locality` agreement using Pass 1 locality when present
  7. `dryRun: true` logs only (no `applyListingEnrichment`)

- [ ] **Step 1: Write failing orchestrator tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../firecrawl/client", () => ({
  firecrawlExtract: vi.fn(),
}));
vi.mock("../db/listings", () => ({
  listEnrichmentCandidates: vi.fn(),
  listRecentlyAcceptedEnrichmentIds: vi.fn(),
  applyListingEnrichment: vi.fn(),
  insertEnrichmentLog: vi.fn(),
}));

import { firecrawlExtract } from "../firecrawl/client";
import {
  applyListingEnrichment,
  insertEnrichmentLog,
  listEnrichmentCandidates,
  listRecentlyAcceptedEnrichmentIds,
} from "../db/listings";
import { enrichListings } from "./enrich-listings";

const weakEmpty = {
  id: "1",
  title: "Brand X Koramangala",
  sourceUrl: "https://ex.com/1",
  area: "",
  address: "",
  pricingHint: "₹20,000/month",
  lat: 12.91,
  lng: 77.64,
  syncedAt: "2026-07-31T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.ENRICH_DISABLED;
  vi.mocked(listRecentlyAcceptedEnrichmentIds).mockResolvedValue(new Map());
  vi.mocked(applyListingEnrichment).mockResolvedValue();
  vi.mocked(insertEnrichmentLog).mockResolvedValue();
});

describe("enrichListings", () => {
  it("no-ops when ENRICH_DISABLED=1", async () => {
    process.env.ENRICH_DISABLED = "1";
    const r = await enrichListings();
    expect(r).toEqual({
      scanned: 0,
      queued: 0,
      pageAccepted: 0,
      webAccepted: 0,
      skippedCooldown: 0,
    });
    expect(listEnrichmentCandidates).not.toHaveBeenCalled();
  });

  it("runs Pass 1, writes gated location, skips healthy rows", async () => {
    vi.mocked(listEnrichmentCandidates).mockResolvedValue([
      weakEmpty,
      { ...weakEmpty, id: "2", sourceUrl: "https://ex.com/2", area: "HSR Layout", address: "x" },
    ]);
    vi.mocked(firecrawlExtract).mockResolvedValueOnce(
      new Map([
        [
          "https://ex.com/1",
          {
            locality: "Koramangala",
            address: null,
            monthly_price_inr: null,
            price_basis: null,
            brand_match: true,
            confidence: "medium",
            evidence: null,
          },
        ],
      ]),
    );

    const r = await enrichListings({ webLimit: 0 });
    expect(r.queued).toBe(1);
    expect(r.pageAccepted).toBe(1);
    expect(applyListingEnrichment).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({ area: "Koramangala", locationChanged: true }),
    );
    expect(firecrawlExtract).toHaveBeenCalledOnce();
  });

  it("skips cooldown when last accept is at/after syncedAt", async () => {
    vi.mocked(listEnrichmentCandidates).mockResolvedValue([weakEmpty]);
    vi.mocked(listRecentlyAcceptedEnrichmentIds).mockResolvedValue(
      new Map([["1", "2026-07-31T00:00:00.000Z"]]),
    );
    const r = await enrichListings();
    expect(r.skippedCooldown).toBe(1);
    expect(firecrawlExtract).not.toHaveBeenCalled();
  });

  it("dryRun does not apply writes", async () => {
    vi.mocked(listEnrichmentCandidates).mockResolvedValue([weakEmpty]);
    vi.mocked(firecrawlExtract).mockResolvedValueOnce(
      new Map([
        [
          "https://ex.com/1",
          {
            locality: "Koramangala",
            address: null,
            monthly_price_inr: null,
            price_basis: null,
            brand_match: true,
            confidence: "high",
            evidence: null,
          },
        ],
      ]),
    );
    await enrichListings({ dryRun: true, webLimit: 0 });
    expect(applyListingEnrichment).not.toHaveBeenCalled();
    expect(insertEnrichmentLog).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run lib/sync/enrich-listings.test.ts
```

- [ ] **Step 3: Implement `lib/sync/enrich-listings.ts`**

Implement the flow described in Interfaces. Keep the file focused: select → filter → pass1 → gate/write/log → pass2 → gate/write/log. Use in-memory updates of candidate snapshots after Pass 1 so Pass 2 miss detection sees healed fields. Cap Pass 2 URL list with `webLimit`. Always `insertEnrichmentLog` (even dry-run) so dry-run still produces audit evidence — **or** skip log on dry-run if you prefer zero DB writes; pick **log on dry-run, skip apply** and document it in the script help text.

- [ ] **Step 4: Re-run — expect PASS**

```bash
npx vitest run lib/sync/enrich-listings.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/sync/enrich-listings.ts lib/sync/enrich-listings.test.ts
git commit -m "$(cat <<'EOF'
feat(sync): orchestrate batched Firecrawl listing enrichment passes

EOF
)"
```

---

### Task 6: Wire enrich into `runListingsSync` (before embed) + soft-fail

**Files:**
- Modify: `lib/sync/run-sync.ts`
- Modify: `lib/sync/run-sync.test.ts`

**Interfaces:**
- Consumes: `enrichListings()` from `./enrich-listings`
- Produces: downstream order `enrich → embed → geocode → graph`, each in its own try/catch soft-fail

- [ ] **Step 1: Extend soft-fail test**

In `lib/sync/run-sync.test.ts`, mock `./enrich-listings`:

```ts
vi.mock("./enrich-listings", () => ({
  enrichListings: vi.fn(),
}));
```

Import `enrichListings`. In `beforeEach`, `mockResolvedValue({ scanned: 0, queued: 0, pageAccepted: 0, webAccepted: 0, skippedCooldown: 0 })`.

Update `"soft-fails downstream hooks..."` to also reject enrich once and assert:

```ts
vi.mocked(enrichListings).mockRejectedValueOnce(new Error("enrich failed"));
// ...
expect(enrichListings).toHaveBeenCalledOnce();
expect(embedListingsMissingEmbedding).toHaveBeenCalledOnce();
expect(geocodeListingsMissingCoords).toHaveBeenCalledOnce();
```

Add ordering test:

```ts
it("runs enrich before embed and geocode", async () => {
  // same successful source fixture as soft-fail test
  const order: string[] = [];
  vi.mocked(enrichListings).mockImplementation(async () => {
    order.push("enrich");
    return { scanned: 0, queued: 0, pageAccepted: 0, webAccepted: 0, skippedCooldown: 0 };
  });
  vi.mocked(embedListingsMissingEmbedding).mockImplementation(async () => {
    order.push("embed");
    return 0;
  });
  vi.mocked(geocodeListingsMissingCoords).mockImplementation(async () => {
    order.push("geocode");
    return { updated: 0, skipped: 0, failed: 0, scanned: 0 };
  });
  await runListingsSync({ adapters: [cofynd], now: new Date("2026-07-30T00:00:00Z") });
  expect(order.slice(0, 3)).toEqual(["enrich", "embed", "geocode"]);
});
```

- [ ] **Step 2: Run — expect FAIL** (enrich not called / wrong order)

```bash
npx vitest run lib/sync/run-sync.test.ts
```

- [ ] **Step 3: Wire `run-sync.ts`**

Inside `if (anySuccess && !skipDownstream)` **before** embed:

```ts
try {
  await enrichListings();
} catch (downstreamError) {
  console.error("enrichment sync failed:", downstreamError);
}
```

- [ ] **Step 4: Re-run — expect PASS**

```bash
npx vitest run lib/sync/run-sync.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/sync/run-sync.ts lib/sync/run-sync.test.ts
git commit -m "$(cat <<'EOF'
feat(sync): soft-fail listing enrichment before embed/geocode

EOF
)"
```

---

### Task 7: CLI script + npm script + env docs

**Files:**
- Create: `scripts/enrich-listings.ts`
- Modify: `package.json`
- Modify: `README.md` (short enrichment section + env knobs)

**Interfaces:**
- `npm run enrich:listings` → `tsx --env-file=.env.local scripts/enrich-listings.ts`
- CLI flags: `--dry-run` (default true for safety on first use), `--apply` to write, optional `--web-limit=N`

- [ ] **Step 1: Write the script**

```ts
/**
 * Batch-enrich weak listings via Firecrawl Extract.
 *
 * Usage:
 *   npm run enrich:listings              # dry-run (log only)
 *   npm run enrich:listings -- --apply   # write gated fields
 *   ENRICH_WEB_LIMIT=20 npm run enrich:listings -- --apply
 */
import { enrichListings } from "../lib/sync/enrich-listings";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!process.env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY is required");

  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const webLimitArg = args.find((a) => a.startsWith("--web-limit="));
  const webLimit = webLimitArg ? Number(webLimitArg.split("=")[1]) : undefined;

  const result = await enrichListings({
    dryRun: !apply,
    webLimit: Number.isFinite(webLimit) ? webLimit : undefined,
  });
  console.log(
    `enrich ${apply ? "apply" : "dry-run"}: scanned=${result.scanned} queued=${result.queued} pageAccepted=${result.pageAccepted} webAccepted=${result.webAccepted} skippedCooldown=${result.skippedCooldown}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 2: Add package.json script**

```json
"enrich:listings": "tsx --env-file=.env.local scripts/enrich-listings.ts"
```

- [ ] **Step 3: Document in README**

Add env knobs:

- `ENRICH_DISABLED=1` — skip enrich in sync
- `ENRICH_WEB_LIMIT` — max Pass 2 URLs (default 100)
- `ENRICH_COOLDOWN_DAYS` — skip recently accepted (default 7)

Rollout note: first VM deploy keeps enrich disabled or dry-run until ~20 hand-checked accepts.

- [ ] **Step 4: Commit**

```bash
git add scripts/enrich-listings.ts package.json README.md
git commit -m "$(cat <<'EOF'
feat(sync): add enrich:listings dry-run/apply CLI

EOF
)"
```

---

## Self-review (spec coverage)

| Spec requirement | Task |
| --- | --- |
| Weak select (empty loc / centroid / weak price) | Task 2 + 4 + 5 |
| Pass 1 page extract batched | Task 3 + 5 |
| Pass 2 web extract capped | Task 5 (`ENRICH_WEB_LIMIT`) |
| Moderate confidence gate + Pass1≈Pass2 | Task 2 |
| Live column overwrite + invalidation | Task 4 |
| Audit log migration | Task 1 |
| Soft-fail in run-sync before embed/geocode | Task 6 |
| `ENRICH_DISABLED` / cooldown / manual script | Task 5 + 7 |
| No Vertex batch / no parallel columns | Honored (Firecrawl Extract only) |

**API reality vs design wording:** Firecrawl beta caps extract at **10 URLs/request** and may return a merged object; Task 3 chunks + `listings[]` schema preserves "batched not sequential scrape" while remaining implementable.

**Placeholder scan:** none intentional.

**Type consistency:** `ExtractResult` / `EnrichCandidate` shared across Tasks 2–5; pass names `'page' | 'web'` match migration CHECK.

---

## Rollout (after plan execution)

1. Apply migration 009 on local + VM.
2. `npm run enrich:listings` dry-run on empty-loc cohort; inspect `listing_enrichment_log`.
3. Hand-check ~20 would-be accepts for multi-branch brands.
4. `--apply` small `ENRICH_WEB_LIMIT`; then enable in sync (unset `ENRICH_DISABLED`).
5. `npm run search:eval` — only trust double-digit location-violation deltas.
