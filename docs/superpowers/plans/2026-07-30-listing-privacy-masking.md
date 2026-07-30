# Listing Privacy Masking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop exact prices, coordinates, street addresses, and origin URLs from reaching the browser by masking at a typed read boundary (`PublicListing`), while keeping raw values in Postgres for Places/embeddings/graph.

**Architecture:** One pure mapper `toPublicListing()` converts `Listing` → `PublicListing` (no `address`/`lat`/`lng`/`pricingHint`/`sourceUrl`; offset+rounded `approxLat`/`approxLng` + 500m radius; redacted prose; sanitized area). All server→client paths funnel through it. Browse/detail maps draw circles, not pins. Insight drops pricing facts and coarsens nearby distances to bands.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Google Maps JS API (`@googlemaps/js-api-loader`), existing `approximateCoords`.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-30-listing-privacy-masking-design.md`.
- **Never** send `address`, exact `lat`/`lng`, `pricingHint`, or `sourceUrl` to the browser (payload or UI).
- Masking is **read-boundary only** — database rows stay raw; Places/embeddings/graph keep using real coords and prose.
- `PublicListing` forbids leak fields with `?: never` so a raw `Listing` is not assignable.
- Circle center = `approximateCoords` then round to **3 decimals**; `approxRadiusM = 500`.
- Price UI is always **"Ask for pricing"**; budget filter is **deleted**, not reworked.
- Titles/slugs unchanged.
- Redaction **drops whole sentences**; never fragment-replace. Empty redaction output is valid.
- `sanitizeArea` must **not** reuse prose patterns (preserve "HSR Layout", "Koramangala 5th Block").
- Insight: remove `pricingHint` from facts/renderer; pass **redacted** description into facts; replace `distanceLabel` production use with `distanceBand`; delete unused `distanceLabel`.
- Run `npx vitest run <paths>` for test steps. Commit after each task.
- Work on branch `feat/listing-privacy-masking` in an isolated worktree.

## Parallel execution map

| Wave | Tasks | Notes |
|------|-------|-------|
| **1 (parallel)** | 1 redact, 2 distanceBand, 4 budget delete | Disjoint files — run 3 implementers in isolated worktrees / merge in order 1→2→4 or any order |
| **2** | 3 `toPublicListing` | Needs Task 1 |
| **3 (parallel)** | 5 wire boundaries, 7 insight | Disjoint after Task 3; Task 7 needs Task 2 |
| **4** | 6 maps | Needs Task 5 (`PublicListing` on SpacesMap props) |
| **5** | 8 docs + openmemory | Last |

**Controller note:** Same-branch parallel implementers race on commits. Prefer isolated worktrees per Wave-1/3 task, then merge; or serialize commits while allowing parallel *non-committing* edits only when files cannot overlap.

## File structure

| File | Responsibility |
|------|----------------|
| `lib/listings/redact.ts` | `redactSensitiveText`, `sanitizeArea`, `displayLocationLine` |
| `lib/listings/public.ts` | `PublicListing`, `APPROX_RADIUS_M`, `toPublicListing` |
| `lib/places/distance.ts` | Add `distanceBand`; remove `distanceLabel` |
| `lib/listings/filterListings.ts` | Drop budget fields + `parsePricingHintInr` |
| `components/spaces/useGoogleMap.ts` | Shared Maps JS loader hook |
| `components/spaces/ApproxAreaMap.tsx` | Detail-page circle map |
| `components/spaces/SpacesMap.tsx` | Browse circles, no price in info window |
| `components/spaces/MapEmbed.tsx` | Delete after ApproxAreaMap lands (or leave unused — prefer delete) |
| Server pages/API | Call `toPublicListing` / `listings.map(toPublicListing)` |
| Insight modules | No pricing fact; redacted description; `distanceBand` |

**Redaction impact (pre-measured):** 9/11 non-empty teasers match at least one sensitive pattern. Many are single sentences → empty teaser after drop. Spec accepts this; do not soften patterns without asking.

---

### Task 1: Prose redaction + area sanitize

**Files:**
- Create: `lib/listings/redact.ts`
- Test: `lib/listings/redact.test.ts`

**Interfaces:**
- Produces:
  - `redactSensitiveText(text: string): string`
  - `sanitizeArea(area: string): string`
  - `displayLocationLine(area: string, city: string): string` — uses `sanitizeArea`; maps city `Bengaluru` → `Bangalore`; joins with `", "` after filtering empties

- [ ] **Step 1: Write the failing test**

Create `lib/listings/redact.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  displayLocationLine,
  redactSensitiveText,
  sanitizeArea,
} from "./redact";

describe("redactSensitiveText", () => {
  it("drops the RMZ Ecoworld located-at sentence and keeps a clean amenities sentence", () => {
    const input =
      "CoWrks is a large format shared office space located at RMZ Ecoworld, Bellandur, Bangalore. High-speed wireless internet and meeting rooms are available for use.";
    const out = redactSensitiveText(input);
    expect(out.toLowerCase()).not.toContain("located at");
    expect(out.toLowerCase()).not.toContain("rmz ecoworld");
    expect(out).toMatch(/High-speed wireless internet/i);
  });

  it("drops the floor / building sentence from Regus Supreme", () => {
    const input =
      "Our Supreme Centre is situated on the 2nd and 3rd Floor, of the Supreme Overseas Exports India Pvt Ltd Building. Members enjoy quiet focus zones.";
    const out = redactSensitiveText(input);
    expect(out.toLowerCase()).not.toContain("2nd");
    expect(out.toLowerCase()).not.toContain("situated on");
    expect(out).toMatch(/quiet focus zones/i);
  });

  it("drops precise metro distance + road sentence", () => {
    const input =
      "The centre is a 2 minute walk from the local bus stand and a 4 minute walk from Lalbhag Metro station. Within 50 meters you have the Bus Depo. Collaborative desks suit growing teams.";
    // "Within 50 meters..." must drop; keep collaborative sentence
    const out = redactSensitiveText(input);
    expect(out.toLowerCase()).not.toContain("within 50");
    expect(out).toMatch(/Collaborative desks/i);
  });

  it("drops currency and PIN sentences", () => {
    const input =
      "Pricing starts at ₹44,999/*. The PIN code is 560103 for deliveries. Friendly community managers greet guests daily.";
    const out = redactSensitiveText(input);
    expect(out).not.toMatch(/₹/);
    expect(out).not.toMatch(/560103/);
    expect(out).toMatch(/Friendly community managers/i);
  });

  it("returns empty string when every sentence is sensitive", () => {
    expect(redactSensitiveText("Located at RMZ Ecoworld, Bellandur.")).toBe("");
  });
});

describe("sanitizeArea", () => {
  it("blanks cofynd markdown blob", () => {
    expect(
      sanitizeArea(
        "![Location](https://cofynd.com/assets/images/icons/co-location-icon.svg) Ashok Nagar",
      ),
    ).toBe("");
  });

  it("blanks address-like plot values", () => {
    expect(sanitizeArea("Metropolis Office Park Plot No: 128-P2")).toBe("");
  });

  it("blanks comma-containing values", () => {
    expect(sanitizeArea("Bellandur, Bengaluru")).toBe("");
  });

  it("keeps real localities including Layout and Block", () => {
    expect(sanitizeArea("Bellandur")).toBe("Bellandur");
    expect(sanitizeArea("HSR Layout")).toBe("HSR Layout");
    expect(sanitizeArea("Koramangala 5th Block")).toBe("Koramangala 5th Block");
  });
});

describe("displayLocationLine", () => {
  it("falls back to Bangalore when area is empty", () => {
    expect(displayLocationLine("", "Bengaluru")).toBe("Bangalore");
  });

  it("joins sanitized area and city", () => {
    expect(displayLocationLine("Bellandur", "Bengaluru")).toBe("Bellandur, Bangalore");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/listings/redact.test.ts`  
Expected: FAIL — cannot find module `./redact`.

- [ ] **Step 3: Implement `lib/listings/redact.ts`**

```ts
const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

const SENSITIVE = [
  /₹/i,
  /\bRs\.?\b/i,
  /\bINR\b/i,
  /\d{4,}\s*(?:\/|per)/i,
  /\b(?:road|rd|street|st|avenue|lane|layout|plot|tower|wing|survey\s*no)\b/i,
  /\b\d+(?:st|nd|rd|th)\s+(?:floor|cross|block|phase)\b/i,
  /\b5\d{5}\b/,
  /\b(?:located|situated)\s+(?:at|on|in)\b/i,
  /\bwithin\s+\d+\s+meters?\b/i,
  /\b\d+\s+meters?\s+(?:away|from)\b/i,
];

export function redactSensitiveText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const sentences = trimmed.split(SENTENCE_SPLIT).map((s) => s.trim()).filter(Boolean);
  const kept = sentences.filter((sentence) => !SENSITIVE.some((re) => re.test(sentence)));
  return kept.join(" ").trim();
}

export function sanitizeArea(area: string): string {
  const trimmed = area.trim();
  if (!trimmed) return "";
  if (trimmed.length > 40) return "";
  if (trimmed.includes(",")) return "";
  if (/https?:\/\//i.test(trimmed) || /!\[[^\]]*\]\(/.test(trimmed)) return "";
  if (/\bplot\b/i.test(trimmed) || /\bno\s*:/i.test(trimmed) || /\bsurvey\b/i.test(trimmed)) {
    return "";
  }
  if (/\b5\d{5}\b/.test(trimmed)) return "";
  return trimmed;
}

function cityLabel(city: string): string {
  const t = city.trim();
  if (!t) return "";
  return t === "Bengaluru" ? "Bangalore" : t;
}

export function displayLocationLine(area: string, city: string): string {
  return [sanitizeArea(area), cityLabel(city)].filter(Boolean).join(", ");
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run lib/listings/redact.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/listings/redact.ts lib/listings/redact.test.ts
git commit -m "feat(privacy): add prose redaction and area sanitize helpers"
```

---

### Task 2: `distanceBand` replaces `distanceLabel`

**Files:**
- Modify: `lib/places/distance.ts`
- Modify: `lib/places/distance.test.ts`
- Modify: `lib/spaces/insight.ts` (swap import/call only — keep field name `distanceLabel` on places)

**Interfaces:**
- Produces: `distanceBand(meters: number): string`
- Removes: `distanceLabel` export and its tests
- `insight.ts` `fetchNearbyGroups` uses `distanceBand(place.distanceMeters)` assigned into `distanceLabel` field

- [ ] **Step 1: Rewrite failing tests in `lib/places/distance.test.ts`**

Replace `distanceLabel` describe block with:

```ts
import { describe, expect, it } from "vitest";
import { distanceBand, haversineMeters } from "./distance";

// keep existing haversineMeters tests unchanged

describe("distanceBand", () => {
  it("uses walking distance under 500m", () => {
    expect(distanceBand(0)).toBe("walking distance");
    expect(distanceBand(499)).toBe("walking distance");
  });

  it("uses ~1 km from 500m inclusive to under 1500m", () => {
    expect(distanceBand(500)).toBe("~1 km");
    expect(distanceBand(1499)).toBe("~1 km");
  });

  it("rounds to nearest kilometre from 1500m", () => {
    expect(distanceBand(1500)).toBe("~2 km");
    expect(distanceBand(2400)).toBe("~2 km");
    expect(distanceBand(2600)).toBe("~3 km");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (missing `distanceBand` / leftover `distanceLabel`)

Run: `npx vitest run lib/places/distance.test.ts`

- [ ] **Step 3: Implement**

In `lib/places/distance.ts`, replace `distanceLabel` with:

```ts
export function distanceBand(meters: number): string {
  if (meters < 500) return "walking distance";
  if (meters < 1500) return "~1 km";
  return `~${Math.round(meters / 1000)} km`;
}
```

In `lib/spaces/insight.ts`: change import `distanceLabel` → `distanceBand` and call site.

- [ ] **Step 4: Update insight tests that assert `~300 m` style labels**

In `lib/spaces/insight.test.ts`, `lib/spaces/insight-prompt.test.ts`, `app/api/spaces/insight/route.test.ts`, and any fixture using `~300 m` / `~1.2 km` as *expected rendered nearby output from production path*, switch production-path expectations to band strings (`walking distance`, `~1 km`). Fixtures that only feed opaque `distanceLabel` strings into `parseInsightJson` may keep any string — the prompt treats them as opaque. Prefer updating production-orchestrator mocks to band-shaped labels for consistency.

Run: `npx vitest run lib/places/distance.test.ts lib/spaces/insight.test.ts lib/spaces/insight-prompt.test.ts app/api/spaces/insight/route.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/places/distance.ts lib/places/distance.test.ts lib/spaces/insight.ts lib/spaces/insight.test.ts lib/spaces/insight-prompt.test.ts app/api/spaces/insight/route.test.ts
git commit -m "feat(privacy): coarsen nearby distances to privacy-safe bands"
```

---

### Task 3: `PublicListing` + `toPublicListing`

**Files:**
- Create: `lib/listings/public.ts`
- Test: `lib/listings/public.test.ts`

**Interfaces:**
- Consumes: `Listing`, `approximateCoords`, `redactSensitiveText`, `sanitizeArea`
- Produces: `PublicListing`, `APPROX_RADIUS_M = 500`, `toPublicListing(listing: Listing): PublicListing`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { haversineMeters } from "../places/distance";
import { toPublicListing, APPROX_RADIUS_M } from "./public";
import type { Listing } from "./types";

const sample: Listing = {
  id: "listing-a",
  source: "coworker",
  sourceId: "src-1",
  slug: "cowrks-ecoworld",
  title: "CoWrks Ecoworld",
  description:
    "CoWrks is located at RMZ Ecoworld, Bellandur. High-speed wireless internet is available.",
  shortTeaser: "Located at RMZ Ecoworld, Bellandur.",
  address: "Bellandur, Bengaluru, Karnataka 560103, India",
  area: "Bellandur",
  city: "Bengaluru",
  lat: 12.9352,
  lng: 77.6245,
  amenities: ["Wi-Fi"],
  images: ["https://example.com/a.jpg"],
  pricingHint: "₹ 20000/month",
  propertyType: "Coworking",
  sourceUrl: "https://example.com/listing",
  syncedAt: "2026-07-30T00:00:00.000Z",
};

describe("toPublicListing", () => {
  it("omits forbidden keys from the object", () => {
    const pub = toPublicListing(sample);
    for (const key of ["address", "pricingHint", "lat", "lng", "sourceUrl", "sourceId"] as const) {
      expect(key in pub).toBe(false);
    }
  });

  it("offsets and rounds approximates inside the privacy radius", () => {
    const pub = toPublicListing(sample);
    expect(pub.approxRadiusM).toBe(APPROX_RADIUS_M);
    expect(pub.approxLat).not.toBeNull();
    expect(pub.approxLng).not.toBeNull();
    expect(pub.approxLat).not.toBe(sample.lat);
    expect(pub.approxLng).not.toBe(sample.lng);
    // 3 decimal places
    expect(String(pub.approxLat)).toMatch(/^-?\d+\.\d{1,3}$/);
    const meters = haversineMeters(
      { lat: sample.lat!, lng: sample.lng! },
      { lat: pub.approxLat!, lng: pub.approxLng! },
    );
    expect(meters).toBeLessThanOrEqual(APPROX_RADIUS_M);
    expect(meters).toBeGreaterThan(0);
  });

  it("nulls approximates when coords missing", () => {
    const pub = toPublicListing({ ...sample, lat: null, lng: null });
    expect(pub.approxLat).toBeNull();
    expect(pub.approxLng).toBeNull();
    expect(pub.approxRadiusM).toBe(APPROX_RADIUS_M);
  });

  it("redacts prose and sanitizes area", () => {
    const pub = toPublicListing(sample);
    expect(pub.description.toLowerCase()).not.toContain("located at");
    expect(pub.shortTeaser).toBe("");
    expect(pub.area).toBe("Bellandur");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run lib/listings/public.test.ts`

- [ ] **Step 3: Implement `lib/listings/public.ts`**

```ts
import { approximateCoords } from "./approximateCoords";
import { redactSensitiveText, sanitizeArea } from "./redact";
import type { Listing, ListingSource } from "./types";

export const APPROX_RADIUS_M = 500;

export type PublicListing = {
  id: string;
  source: ListingSource;
  slug: string;
  title: string;
  description: string;
  shortTeaser: string;
  area: string;
  city: string;
  approxLat: number | null;
  approxLng: number | null;
  approxRadiusM: number;
  amenities: string[];
  images: string[];
  propertyType: string | null;
  syncedAt: string;
  address?: never;
  pricingHint?: never;
  sourceUrl?: never;
  lat?: never;
  lng?: never;
  sourceId?: never;
};

function roundCoord(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function toPublicListing(listing: Listing): PublicListing {
  let approxLat: number | null = null;
  let approxLng: number | null = null;
  if (listing.lat != null && listing.lng != null) {
    const offset = approximateCoords(listing.lat, listing.lng, listing.id);
    approxLat = roundCoord(offset.lat);
    approxLng = roundCoord(offset.lng);
  }

  return {
    id: listing.id,
    source: listing.source,
    slug: listing.slug,
    title: listing.title,
    description: redactSensitiveText(listing.description),
    shortTeaser: redactSensitiveText(listing.shortTeaser),
    area: sanitizeArea(listing.area),
    city: listing.city,
    approxLat,
    approxLng,
    approxRadiusM: APPROX_RADIUS_M,
    amenities: listing.amenities,
    images: listing.images,
    propertyType: listing.propertyType,
    syncedAt: listing.syncedAt,
  };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/listings/public.ts lib/listings/public.test.ts
git commit -m "feat(privacy): add PublicListing mapper at the read boundary"
```

---

### Task 4: Delete budget filter + pricing parse

**Files:**
- Modify: `lib/listings/filterListings.ts`
- Modify: `lib/listings/filterListings.test.ts`
- Modify: `components/spaces/SpacesFiltersModal.tsx` (remove Budget section; retype later in Task 5 if still on `Listing`)

**Interfaces:**
- `SpacesFilterState` = `{ deskTypes, areas, amenities }` only
- Remove `parsePricingHintInr`, budget branches, budget chips, Budget UI section

- [ ] **Step 1: Update tests — remove parsePricingHint + budget cases; fix chips**

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run lib/listings/filterListings.test.ts`

- [ ] **Step 3: Implement filter + modal deletions**

`filterListings.ts` final shape:

```ts
import type { Listing } from "./types";
// After Task 5, change Listing → PublicListing import from ./public

export type SpacesFilterState = {
  deskTypes: string[];
  areas: string[];
  amenities: string[];
};

export const EMPTY_FILTERS: SpacesFilterState = {
  deskTypes: [],
  areas: [],
  amenities: [],
};

export function applySpacesFilters(
  listings: Listing[],
  filters: SpacesFilterState,
): Listing[] {
  return listings.filter((listing) => {
    if (filters.deskTypes.length > 0) {
      const propertyType = (listing.propertyType ?? "").toLowerCase();
      if (
        !filters.deskTypes.some((deskType) =>
          propertyType.includes(deskType.toLowerCase()),
        )
      ) {
        return false;
      }
    }
    if (filters.areas.length > 0) {
      const area = listing.area.toLowerCase();
      if (!filters.areas.some((filterArea) => area === filterArea.toLowerCase())) {
        return false;
      }
    }
    if (filters.amenities.length > 0) {
      const amenities = listing.amenities.join(" ").toLowerCase();
      if (
        !filters.amenities.every((amenity) =>
          amenities.includes(amenity.toLowerCase()),
        )
      ) {
        return false;
      }
    }
    return true;
  });
}

export function activeFilterChips(filters: SpacesFilterState): string[] {
  return [...filters.deskTypes, ...filters.areas, ...filters.amenities];
}
```

Remove the entire Budget `/ month` `<section>` from `SpacesFiltersModal.tsx`.

- [ ] **Step 4: Run tests PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/listings/filterListings.ts lib/listings/filterListings.test.ts components/spaces/SpacesFiltersModal.tsx
git commit -m "feat(privacy): remove budget filter and price parsing"
```

---

### Task 5: Wire read boundary + client `PublicListing` types

**Files:**
- Modify: `app/spaces/page.tsx` — `listListings().then(rows => rows.map(toPublicListing))` (or map before return)
- Modify: `app/api/spaces/search/route.ts` — map `listings` through `toPublicListing` before JSON
- Modify: `app/api/spaces/search/route.test.ts` — assert serialized JSON has no forbidden keys
- Modify: `app/spaces/[slug]/page.tsx` — `toPublicListing`; use `displayLocationLine`; metadata uses redacted description; aside always "Ask for pricing"; **keep MapEmbed temporarily only if you pass approx coords — prefer stubbing map section with text placeholder until Task 6**, or pass `approxLat`/`approxLng` into a temporary note. **Do not pass exact lat/lng.** Simplest: remove `<MapEmbed …>` in this task and leave a comment / text "Approximate area — {displayLocationLine}" until Task 6 adds `ApproxAreaMap`.
- Modify: `components/spaces/SpacesBrowseClient.tsx`, `SpaceCard.tsx`, `SpacesHomeHero.tsx`, `SpacesFiltersModal.tsx`, `SpacesMap.tsx` props — `Listing` → `PublicListing`
- Modify: `lib/listings/filterListings.ts` — parameter type `PublicListing`
- Modify: `SpaceCard` location line — prefer `displayLocationLine(listing.area, listing.city)` (import from redact; client-safe pure module)

**Interfaces:**
- Search response `listings: PublicListing[]`
- Load-bearing test: after success path, `JSON.stringify` body must not match `/"address"|/"pricingHint"|/"sourceUrl"|/"lat"|/"lng"|/"sourceId"/`

- [ ] **Step 1: Add failing assertion to search route test** on successful response body keys

```ts
it("masks listing privacy fields in the JSON payload", async () => {
  // arrange mocks like existing success test so POST returns 200 with listings
  const res = await postSearch({ query: "quiet cabin" });
  expect(res.status).toBe(200);
  const body = await res.json();
  const raw = JSON.stringify(body.listings);
  expect(raw).not.toMatch(/"address"/);
  expect(raw).not.toMatch(/"pricingHint"/);
  expect(raw).not.toMatch(/"sourceUrl"/);
  expect(raw).not.toMatch(/"sourceId"/);
  expect(raw).not.toMatch(/"lat"/);
  expect(raw).not.toMatch(/"lng"/);
  expect(raw).toMatch(/"approxLat"/);
});
```

Wire mocks identically to the existing happy-path test in the same file.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement all wiring + retypes**

Search route change (conceptually):

```ts
import { toPublicListing } from "@/lib/listings/public";
// ...
return NextResponse.json({
  interpretedQuery,
  listings: listings.map(toPublicListing),
  matchedEntities,
});
```

Detail page aside:

```tsx
<p className="text-[22px] font-bold text-[var(--ink)]">Ask for pricing</p>
```

Metadata description: `redactSensitiveText(listing.shortTeaser || listing.description).slice(0, 160)` after mapping, or redact from raw before map — must not use unredacted description.

- [ ] **Step 4: Run**

`npx vitest run app/api/spaces/search/route.test.ts lib/listings/filterListings.test.ts`

Also ensure TypeScript accepts client props (fix with `npx tsc --noEmit` if project supports it, or rely on next build later).

- [ ] **Step 5: Commit**

```bash
git add app/spaces/page.tsx app/api/spaces/search/route.ts app/api/spaces/search/route.test.ts app/spaces/\[slug\]/page.tsx components/spaces/SpacesBrowseClient.tsx components/spaces/SpaceCard.tsx components/spaces/SpacesHomeHero.tsx components/spaces/SpacesFiltersModal.tsx components/spaces/SpacesMap.tsx lib/listings/filterListings.ts
git commit -m "feat(privacy): mask listings at page and search read boundaries"
```

---

### Task 6: Circle maps + shared hook

**Files:**
- Create: `components/spaces/useGoogleMap.ts`
- Create: `components/spaces/ApproxAreaMap.tsx`
- Modify: `components/spaces/SpacesMap.tsx` — circles from `approxLat`/`approxLng`/`approxRadiusM`; no price in info window; active state via circle stroke/fill
- Modify: `app/spaces/[slug]/page.tsx` — render `ApproxAreaMap` with approx coords + `displayLocationLine`
- Delete: `components/spaces/MapEmbed.tsx` if unused

**Interfaces:**
- `useGoogleMap(containerRef): { map, mapReady, loadFailed }`
- `ApproxAreaMap({ approxLat, approxLng, approxRadiusM, locationLabel })`

- [ ] **Step 1: Extract loader from current SpacesMap into `useGoogleMap`**

Hook responsibilities: read `NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY`, `setOptions` + `importLibrary("maps")`, create `google.maps.Map` centered on Bangalore zoom 12, set `mapReady` / `loadFailed`, cleanup on unmount.

- [ ] **Step 2: Rewrite SpacesMap markers → circles**

```ts
// per listing with approxLat/approxLng:
const circle = new google.maps.Circle({
  map,
  center: { lat: listing.approxLat, lng: listing.approxLng },
  radius: listing.approxRadiusM,
  fillColor: "#8B5E3C",
  fillOpacity: 0.25,
  strokeWeight: 1,
  strokeColor: "#ffffff",
  clickable: true,
});
bounds.union(circle.getBounds()!);
// click / mouseover → onActivate; InfoWindow content = title link only (no pricingHint)
```

Active highlight: higher fillOpacity + accent stroke for `activeId`.

- [ ] **Step 3: ApproxAreaMap for detail**

Zoom ~14, single circle, fallback text: `Approximate area — ${locationLabel}` when no key / load fail / null coords.

- [ ] **Step 4: Manual smoke** — `npm run dev`, open `/spaces` and one detail page; confirm no exact coords in page source (`view-source` / Network HTML) for `pricingHint` or street addresses from sample listings.

- [ ] **Step 5: Commit**

```bash
git add components/spaces/useGoogleMap.ts components/spaces/ApproxAreaMap.tsx components/spaces/SpacesMap.tsx app/spaces/\[slug\]/page.tsx
git add -u components/spaces/MapEmbed.tsx  # if deleted
git commit -m "feat(privacy): show approximate area circles instead of exact map pins"
```

---

### Task 7: Insight — drop pricing + redacted description

**Files:**
- Modify: `lib/spaces/insight-types.ts` — remove `pricingHint` from `InsightFacts`
- Modify: `lib/spaces/insight-prompt.ts` — remove pricing evidence entry + "Pricing" highlight branch
- Modify: `lib/spaces/insight.ts` — build facts without pricing; set `description: redactSensitiveText(listing.description)` (import from listings/redact); remove `pricingHint` from fingerprint listing pick
- Modify: tests/fixtures that construct `InsightFacts` with `pricingHint`
- Modify: Vertex/OpenAI explainListingFit tests if they pass pricingHint

- [ ] **Step 1: Update unit tests expecting pricing highlight / facts field**

- [ ] **Step 2: Run insight-related tests — expect FAIL**

`npx vitest run lib/spaces/insight-prompt.test.ts lib/spaces/insight.test.ts lib/ai/insight-client.test.ts lib/openai/client.test.ts lib/vertex/client.test.ts app/api/spaces/insight/route.test.ts`

- [ ] **Step 3: Implement removals + redacted description in `buildInsight` facts**

Ensure fingerprint no longer includes `pricingHint` (field gone). Description in fingerprint is already sliced — now redacted first.

- [ ] **Step 4: Run tests PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/spaces/insight-types.ts lib/spaces/insight-prompt.ts lib/spaces/insight.ts lib/spaces/insight-prompt.test.ts lib/spaces/insight.test.ts lib/ai/insight-client.test.ts lib/openai/client.test.ts lib/vertex/client.test.ts app/api/spaces/insight/route.test.ts
git commit -m "feat(privacy): strip pricing from insight facts and redact description evidence"
```

---

### Task 8: Docs + openmemory

**Files:**
- Modify: `README.md` — short note that browse/detail show approximate location and ask-for-pricing; exact values never leave the server read boundary
- Modify: `openmemory.md` — Components/Patterns for `PublicListing`, redact, circle maps, insight bands
- Modify: design status line to `implemented` when done (optional)

- [ ] **Step 1: Update docs**

- [ ] **Step 2: Commit**

```bash
git add README.md openmemory.md docs/superpowers/specs/2026-07-30-listing-privacy-masking-design.md
git commit -m "docs: document listing privacy masking at the read boundary"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| `PublicListing` + `?: never` | 3 |
| `toPublicListing` offset+round+radius 500 | 3 |
| Redact sentences / sanitizeArea / displayLocationLine | 1 |
| Wire page, search, detail | 5 |
| Search JSON no forbidden keys test | 5 |
| Delete budget filter | 4 |
| Ask for pricing only | 5 |
| Circle browse map + ApproxAreaMap | 6 |
| useGoogleMap extract | 6 |
| Insight no pricing + redacted description | 7 |
| distanceBand + delete distanceLabel | 2 |
| Docs | 8 |
| Titles unchanged | (non-goal — no task) |

No TBD placeholders. Types consistent: `PublicListing`, `APPROX_RADIUS_M`, `distanceBand`, `displayLocationLine`.
