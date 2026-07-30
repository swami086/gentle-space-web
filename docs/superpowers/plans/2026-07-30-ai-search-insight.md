# AI Search Result Insight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand "Why this fits" panel to each AI search result that shows query-relevant highlights plus beneficial nearby Google Maps locations, grounded in real data.

**Architecture:** A new `POST /api/spaces/insight` endpoint loads the listing's real coordinates, picks nearby categories from the search's extracted entities (with a commuter default), queries Google Places API (New) Nearby Search, then asks Gemini to phrase query-relevant highlights using only those facts. Two process-local cache layers keep spend bounded: a long-lived query-independent nearby cache and a short-lived per-query phrasing cache.

**Tech Stack:** Next.js 15 App Router, TypeScript, vitest (mocked `fetch`), Postgres (`pg`), Vertex AI Gemini `gemini-2.5-flash-lite` (OpenAI fallback), Google Places API (New).

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-30-ai-search-insight-design.md`.
- **No pros/cons content anywhere.** The panel shows `summary`, `highlights`, and `nearby` only. The AI prompt must explicitly forbid drawbacks/cons/considerations.
- Nearby lookups use the listing's **real** `lat`/`lng` server-side. Only place **names + coarse distance labels** may reach the client — never exact addresses.
- Nearby is **best-effort**: any Places failure, missing key, or missing coordinates must still return `summary` + `highlights` with `nearby` omitted.
- Cost caps: **≤3 categories**, **≤3 places per category**, field-masked Places requests, on-demand only (nothing generated until the user expands a result).
- Cache TTLs: nearby **30 days**, insight **24 hours**. Never cache an empty/failed AI result.
- Follow existing repo patterns: `lib/ai/client.ts` facade shape, `lib/graph/extract.ts` JSON-guard shape, vitest with `vi.mock` + mocked `fetch`.
- Google Places API (New) is already enabled on project `propane-galaxy-498403-n8`. The key is read from `GOOGLE_PLACES_API_KEY`.
- Run `npm test` (vitest) for all test steps. Commit after each task.

---

### Task 1: Nearby category selection

Pure, dependency-free mapping from extracted query entities to Google Places `includedTypes`. No I/O — this is the piece that makes "taking cues from the user's search" deterministic and testable.

**Files:**
- Create: `lib/places/types.ts`
- Create: `lib/places/categories.ts`
- Test: `lib/places/categories.test.ts`

**Interfaces:**
- Consumes: `QueryEntities` from `lib/graph/types.ts` (`{ areas, amenities, deskTypes, landmarks, budgetSignals }`, all `string[]`).
- Produces: `NearbyCategory = { key: string; label: string; includedTypes: string[] }`, `NearbyPlace = { name: string; distanceMeters: number }`, `NearbyGroup = { category: string; label: string; places: { name: string; distanceLabel: string }[] }`, `selectNearbyCategories(entities: QueryEntities): NearbyCategory[]`, `DEFAULT_CATEGORIES`, `MAX_CATEGORIES`.

- [ ] **Step 1: Write the failing test**

Create `lib/places/categories.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyQueryEntities } from "../graph/types";
import { DEFAULT_CATEGORIES, MAX_CATEGORIES, selectNearbyCategories } from "./categories";

describe("selectNearbyCategories", () => {
  it("maps query cues to places types", () => {
    const picked = selectNearbyCategories({
      ...emptyQueryEntities(),
      landmarks: ["Metro station"],
      amenities: ["coffee"],
    });

    expect(picked.map((c) => c.key)).toEqual(["transit", "cafe"]);
    expect(picked[0].includedTypes).toContain("subway_station");
    expect(picked[1].includedTypes).toEqual(["cafe"]);
    expect(picked[0].label).toBe("Transit");
  });

  it("falls back to the default commuter set when the query implies nothing", () => {
    expect(selectNearbyCategories(emptyQueryEntities())).toEqual(DEFAULT_CATEGORIES);
  });

  it("dedupes and caps at MAX_CATEGORIES with stable order", () => {
    const picked = selectNearbyCategories({
      ...emptyQueryEntities(),
      landmarks: ["metro", "subway"],
      amenities: ["cafe", "coffee", "gym", "parking", "atm"],
    });

    expect(picked).toHaveLength(MAX_CATEGORIES);
    expect(picked.map((c) => c.key)).toEqual(["transit", "cafe", "gym"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/places/categories.test.ts`
Expected: FAIL — cannot find module `./categories`.

- [ ] **Step 3: Write the types**

Create `lib/places/types.ts`:

```ts
export type NearbyCategory = {
  key: string;
  label: string;
  includedTypes: string[];
};

export type NearbyPlace = {
  name: string;
  distanceMeters: number;
};

export type NearbyGroup = {
  category: string;
  label: string;
  places: { name: string; distanceLabel: string }[];
};
```

- [ ] **Step 4: Write the minimal implementation**

Create `lib/places/categories.ts`:

```ts
import type { QueryEntities } from "../graph/types";
import type { NearbyCategory } from "./types";

export const MAX_CATEGORIES = 3;

const TRANSIT: NearbyCategory = {
  key: "transit",
  label: "Transit",
  includedTypes: ["subway_station", "train_station"],
};
const RESTAURANT: NearbyCategory = {
  key: "restaurant",
  label: "Food",
  includedTypes: ["restaurant"],
};
const ATM: NearbyCategory = { key: "atm", label: "ATMs", includedTypes: ["atm"] };

// Rule order defines output order, which keeps the nearby cache key stable.
const CATEGORY_RULES: { match: RegExp; category: NearbyCategory }[] = [
  { match: /\b(metro|subway|station|transit|rail)\b/, category: TRANSIT },
  { match: /\b(coffee|cafe|café|barista)\b/, category: { key: "cafe", label: "Cafes", includedTypes: ["cafe"] } },
  { match: /\b(food|lunch|restaurant|dining|eat)\b/, category: RESTAURANT },
  { match: /\b(gym|fitness|workout)\b/, category: { key: "gym", label: "Gyms", includedTypes: ["gym"] } },
  { match: /\b(parking|car park)\b/, category: { key: "parking", label: "Parking", includedTypes: ["parking"] } },
  { match: /\b(bank|atm)\b/, category: ATM },
  { match: /\b(airport)\b/, category: { key: "airport", label: "Airport", includedTypes: ["airport"] } },
  { match: /\b(mall|shopping)\b/, category: { key: "mall", label: "Shopping", includedTypes: ["shopping_mall"] } },
];

export const DEFAULT_CATEGORIES: NearbyCategory[] = [TRANSIT, RESTAURANT, ATM];

export function selectNearbyCategories(entities: QueryEntities): NearbyCategory[] {
  const haystack = [...entities.landmarks, ...entities.amenities, ...entities.deskTypes]
    .join(" ")
    .toLowerCase();

  const picked: NearbyCategory[] = [];
  const seen = new Set<string>();

  for (const rule of CATEGORY_RULES) {
    if (picked.length >= MAX_CATEGORIES) break;
    if (!rule.match.test(haystack)) continue;
    if (seen.has(rule.category.key)) continue;
    seen.add(rule.category.key);
    picked.push(rule.category);
  }

  return picked.length > 0 ? picked : DEFAULT_CATEGORIES;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/places/categories.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/places/types.ts lib/places/categories.ts lib/places/categories.test.ts
git commit -m "feat(places): select nearby categories from query entities"
```

---

### Task 2: Distance helpers and Places API client

Straight-line distance + friendly labels (pure), and the Google Places API (New) Nearby Search call with a field mask.

**Files:**
- Create: `lib/places/distance.ts`
- Create: `lib/places/client.ts`
- Test: `lib/places/distance.test.ts`
- Test: `lib/places/client.test.ts`

**Interfaces:**
- Consumes: `NearbyCategory`, `NearbyPlace` from `lib/places/types.ts` (Task 1).
- Produces: `haversineMeters(a: {lat:number;lng:number}, b: {lat:number;lng:number}): number`, `distanceLabel(meters: number): string`, `isPlacesConfigured(): boolean`, `searchNearby(origin: {lat:number;lng:number}, category: NearbyCategory): Promise<NearbyPlace[]>` (throws on HTTP failure so callers can degrade).

- [ ] **Step 1: Write the failing distance test**

Create `lib/places/distance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { distanceLabel, haversineMeters } from "./distance";

describe("haversineMeters", () => {
  it("returns 0 for the same point", () => {
    expect(haversineMeters({ lat: 12.93, lng: 77.68 }, { lat: 12.93, lng: 77.68 })).toBe(0);
  });

  it("approximates a short Bangalore hop", () => {
    const meters = haversineMeters({ lat: 12.93, lng: 77.68 }, { lat: 12.934, lng: 77.68 });
    expect(meters).toBeGreaterThan(400);
    expect(meters).toBeLessThan(500);
  });
});

describe("distanceLabel", () => {
  it("rounds sub-kilometre distances to 50 m buckets", () => {
    expect(distanceLabel(320)).toBe("~300 m");
    expect(distanceLabel(340)).toBe("~350 m");
  });

  it("never reports below 50 m", () => {
    expect(distanceLabel(10)).toBe("~50 m");
  });

  it("switches to kilometres at 1000 m", () => {
    expect(distanceLabel(1240)).toBe("~1.2 km");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/places/distance.test.ts`
Expected: FAIL — cannot find module `./distance`.

- [ ] **Step 3: Implement distance helpers**

Create `lib/places/distance.ts`:

```ts
const EARTH_RADIUS_M = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function distanceLabel(meters: number): string {
  if (meters >= 1000) return `~${(meters / 1000).toFixed(1)} km`;
  const rounded = Math.max(50, Math.round(meters / 50) * 50);
  return `~${rounded} m`;
}
```

- [ ] **Step 4: Run distance test to verify it passes**

Run: `npx vitest run lib/places/distance.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Write the failing Places client test**

Create `lib/places/client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPlacesConfigured, searchNearby } from "./client";

const CATEGORY = { key: "cafe", label: "Cafes", includedTypes: ["cafe"] };
const ORIGIN = { lat: 12.93, lng: 77.68 };

beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
});

afterEach(() => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  vi.unstubAllGlobals();
});

describe("isPlacesConfigured", () => {
  it("is false without a key", () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect(isPlacesConfigured()).toBe(false);
  });

  it("is true with a key", () => {
    expect(isPlacesConfigured()).toBe(true);
  });
});

describe("searchNearby", () => {
  it("sends a field-masked request and parses places sorted by distance", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          { displayName: { text: "Far Cafe" }, location: { latitude: 12.938, longitude: 77.68 } },
          { displayName: { text: "Near Cafe" }, location: { latitude: 12.931, longitude: 77.68 } },
          { displayName: { text: "" }, location: { latitude: 12.932, longitude: 77.68 } },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const places = await searchNearby(ORIGIN, CATEGORY);

    expect(places.map((p) => p.name)).toEqual(["Near Cafe", "Far Cafe"]);
    expect(places[0].distanceMeters).toBeLessThan(places[1].distanceMeters);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchNearby");
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(init.headers["X-Goog-FieldMask"]).toBe(
      "places.displayName,places.location,places.primaryType",
    );
    expect(JSON.parse(init.body)).toEqual({
      includedTypes: ["cafe"],
      maxResultCount: 3,
      locationRestriction: {
        circle: { center: { latitude: 12.93, longitude: 77.68 }, radius: 1000 },
      },
    });
  });

  it("throws when the API responds with an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "denied" }),
    );

    await expect(searchNearby(ORIGIN, CATEGORY)).rejects.toThrow("places searchNearby failed: 403");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run lib/places/client.test.ts`
Expected: FAIL — cannot find module `./client`.

- [ ] **Step 7: Implement the Places client**

Create `lib/places/client.ts`:

```ts
import { haversineMeters } from "./distance";
import type { NearbyCategory, NearbyPlace } from "./types";

const PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby";
const FIELD_MASK = "places.displayName,places.location,places.primaryType";
const RADIUS_METERS = 1000;
const MAX_PER_CATEGORY = 3;

function apiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  return key;
}

export function isPlacesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

export async function searchNearby(
  origin: { lat: number; lng: number },
  category: NearbyCategory,
): Promise<NearbyPlace[]> {
  const res = await fetch(PLACES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: category.includedTypes,
      maxResultCount: MAX_PER_CATEGORY,
      locationRestriction: {
        circle: {
          center: { latitude: origin.lat, longitude: origin.lng },
          radius: RADIUS_METERS,
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`places searchNearby failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as {
    places?: {
      displayName?: { text?: string };
      location?: { latitude: number; longitude: number };
    }[];
  };

  const places: NearbyPlace[] = [];
  for (const place of body.places ?? []) {
    const name = place.displayName?.text?.trim();
    if (!name || !place.location) continue;
    places.push({
      name,
      distanceMeters: haversineMeters(origin, {
        lat: place.location.latitude,
        lng: place.location.longitude,
      }),
    });
  }

  return places.sort((a, b) => a.distanceMeters - b.distanceMeters);
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run lib/places/`
Expected: PASS — all category, distance, and client tests.

- [ ] **Step 9: Commit**

```bash
git add lib/places/distance.ts lib/places/client.ts lib/places/distance.test.ts lib/places/client.test.ts
git commit -m "feat(places): add nearby search client with field mask and distance labels"
```

---

### Task 3: Insight types, prompt, and JSON guard

Shared types plus the Gemini/OpenAI prompt and a defensive parser, mirroring `lib/graph/extract.ts`. Kept provider-agnostic so both AI clients reuse it.

**Files:**
- Create: `lib/spaces/insight-types.ts`
- Create: `lib/spaces/insight-prompt.ts`
- Test: `lib/spaces/insight-prompt.test.ts`

**Interfaces:**
- Consumes: `NearbyGroup` from `lib/places/types.ts` (Task 1).
- Produces: `InsightHighlight = { label: string; detail: string }`, `InsightContent = { summary: string; highlights: InsightHighlight[] }`, `InsightFacts`, `InsightResponse = { listingId: string; summary: string; highlights: InsightHighlight[]; nearby: NearbyGroup[] }`, `INSIGHT_SYSTEM`, `buildInsightUserText(facts: InsightFacts): string`, `parseInsightJson(raw: string): InsightContent`, `emptyInsightContent(): InsightContent`.

- [ ] **Step 1: Write the failing test**

Create `lib/spaces/insight-prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { InsightFacts } from "./insight-types";
import { buildInsightUserText, emptyInsightContent, parseInsightJson } from "./insight-prompt";

const facts: InsightFacts = {
  title: "CoWrks Ecoworld",
  area: "Bellandur",
  city: "Bengaluru",
  propertyType: "Coworking",
  pricingHint: "₹9000",
  amenities: ["WiFi", "Parking"],
  description: "A large format shared office space.",
  query: "coworking near metro with coffee",
  nearby: [
    {
      category: "cafe",
      label: "Cafes",
      places: [{ name: "Third Wave", distanceLabel: "~300 m" }],
    },
  ],
};

describe("buildInsightUserText", () => {
  it("includes the query, listing facts and nearby places", () => {
    const text = buildInsightUserText(facts);

    expect(text).toContain("Search: coworking near metro with coffee");
    expect(text).toContain("Space: CoWrks Ecoworld");
    expect(text).toContain("Area: Bellandur, Bengaluru");
    expect(text).toContain("Amenities: WiFi, Parking");
    expect(text).toContain("Nearby Cafes: Third Wave (~300 m)");
  });
});

describe("parseInsightJson", () => {
  it("parses summary and highlights", () => {
    const parsed = parseInsightJson(
      JSON.stringify({
        summary: "Matches your Bellandur ask.",
        highlights: [{ label: "Cafes", detail: "Third Wave ~300 m" }],
      }),
    );

    expect(parsed).toEqual({
      summary: "Matches your Bellandur ask.",
      highlights: [{ label: "Cafes", detail: "Third Wave ~300 m" }],
    });
  });

  it("caps highlights at 4 and drops malformed entries", () => {
    const parsed = parseInsightJson(
      JSON.stringify({
        summary: "ok",
        highlights: [
          { label: "a", detail: "1" },
          { label: "", detail: "2" },
          { label: "c", detail: "3" },
          { label: "d", detail: "4" },
          { label: "e", detail: "5" },
          { label: "f", detail: "6" },
        ],
      }),
    );

    expect(parsed.highlights).toHaveLength(4);
    expect(parsed.highlights.map((h) => h.label)).toEqual(["a", "c", "d", "e"]);
  });

  it("returns empty content for invalid JSON", () => {
    expect(parseInsightJson("not json")).toEqual(emptyInsightContent());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/spaces/insight-prompt.test.ts`
Expected: FAIL — cannot find module `./insight-types`.

- [ ] **Step 3: Write the types**

Create `lib/spaces/insight-types.ts`:

```ts
import type { NearbyGroup } from "../places/types";

export type InsightHighlight = {
  label: string;
  detail: string;
};

export type InsightContent = {
  summary: string;
  highlights: InsightHighlight[];
};

export type InsightFacts = {
  title: string;
  area: string;
  city: string;
  propertyType: string | null;
  pricingHint: string | null;
  amenities: string[];
  description: string;
  query: string;
  nearby: NearbyGroup[];
};

export type InsightResponse = {
  listingId: string;
  summary: string;
  highlights: InsightHighlight[];
  nearby: NearbyGroup[];
};
```

- [ ] **Step 4: Write the prompt and parser**

Create `lib/spaces/insight-prompt.ts`:

```ts
import type { InsightContent, InsightFacts, InsightHighlight } from "./insight-types";

export const INSIGHT_SYSTEM = `You explain why a Bangalore coworking space matches a user's search.
Return only JSON with this shape:
{
  "summary": "one sentence",
  "highlights": [{ "label": "short label", "detail": "short phrase" }]
}
Rules:
- Use ONLY the facts in the user message. Never invent places, distances, amenities or prices.
- Emphasise what the search asked for. At most 4 highlights.
- Each detail must be under 90 characters. No markdown.
- Do not list drawbacks, cons, downsides or considerations.`;

const MAX_HIGHLIGHTS = 4;
const MAX_DESCRIPTION_CHARS = 600;

export function buildInsightUserText(facts: InsightFacts): string {
  const lines = [
    `Search: ${facts.query}`,
    `Space: ${facts.title}`,
    `Area: ${facts.area || "unknown"}, ${facts.city || "Bengaluru"}`,
  ];

  if (facts.propertyType) lines.push(`Type: ${facts.propertyType}`);
  if (facts.pricingHint) lines.push(`Pricing: ${facts.pricingHint}`);
  if (facts.amenities.length > 0) lines.push(`Amenities: ${facts.amenities.join(", ")}`);
  if (facts.description) {
    lines.push(`Description: ${facts.description.slice(0, MAX_DESCRIPTION_CHARS)}`);
  }

  for (const group of facts.nearby) {
    const places = group.places.map((p) => `${p.name} (${p.distanceLabel})`).join(", ");
    if (places) lines.push(`Nearby ${group.label}: ${places}`);
  }

  return lines.join("\n");
}

export function emptyInsightContent(): InsightContent {
  return { summary: "", highlights: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseInsightContent(raw: unknown): InsightContent {
  if (!isRecord(raw)) return emptyInsightContent();

  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  const highlights: InsightHighlight[] = [];

  if (Array.isArray(raw.highlights)) {
    for (const item of raw.highlights) {
      if (highlights.length >= MAX_HIGHLIGHTS) break;
      if (!isRecord(item)) continue;
      const label = typeof item.label === "string" ? item.label.trim() : "";
      const detail = typeof item.detail === "string" ? item.detail.trim() : "";
      if (!label || !detail) continue;
      highlights.push({ label, detail });
    }
  }

  return { summary, highlights };
}

export function parseInsightJson(raw: string): InsightContent {
  try {
    return parseInsightContent(JSON.parse(raw));
  } catch {
    return emptyInsightContent();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/spaces/insight-prompt.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/spaces/insight-types.ts lib/spaces/insight-prompt.ts lib/spaces/insight-prompt.test.ts
git commit -m "feat(spaces): add insight prompt, types and JSON guard"
```

---

### Task 4: AI provider functions and facade

Add `explainListingFit` to both providers and the facade, following the existing `extractSearchEntities` pattern (facade swallows errors and returns empty content; the route decides what an empty result means).

**Files:**
- Modify: `lib/vertex/client.ts` (append new export)
- Modify: `lib/openai/client.ts` (append new export)
- Modify: `lib/ai/client.ts` (append new export)
- Test: `lib/ai/insight-client.test.ts`

**Interfaces:**
- Consumes: `InsightFacts`, `InsightContent` from `lib/spaces/insight-types.ts`; `INSIGHT_SYSTEM`, `buildInsightUserText`, `parseInsightJson`, `emptyInsightContent` from `lib/spaces/insight-prompt.ts` (Task 3).
- Produces: `explainListingFit(facts: InsightFacts): Promise<InsightContent>` exported from `lib/vertex/client.ts`, `lib/openai/client.ts`, and `lib/ai/client.ts`. The facade never throws.

- [ ] **Step 1: Write the failing test**

Create `lib/ai/insight-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InsightFacts } from "../spaces/insight-types";

const openaiExplain = vi.fn();
const vertexExplain = vi.fn();

vi.mock("../openai/client", () => ({
  explainListingFit: (...args: unknown[]) => openaiExplain(...args),
}));

vi.mock("../vertex/client", () => ({
  explainListingFit: (...args: unknown[]) => vertexExplain(...args),
}));

import { explainListingFit } from "./client";

const facts: InsightFacts = {
  title: "CoWrks Ecoworld",
  area: "Bellandur",
  city: "Bengaluru",
  propertyType: null,
  pricingHint: null,
  amenities: [],
  description: "",
  query: "coworking in bellandur",
  nearby: [],
};

afterEach(() => {
  delete process.env.AI_PROVIDER;
  openaiExplain.mockReset();
  vertexExplain.mockReset();
});

describe("explainListingFit facade", () => {
  it("delegates to vertex when configured", async () => {
    process.env.AI_PROVIDER = "vertex";
    vertexExplain.mockResolvedValue({ summary: "fits", highlights: [] });

    await expect(explainListingFit(facts)).resolves.toEqual({ summary: "fits", highlights: [] });
    expect(vertexExplain).toHaveBeenCalledWith(facts);
  });

  it("returns empty content when the provider throws", async () => {
    process.env.AI_PROVIDER = "openai";
    openaiExplain.mockRejectedValue(new Error("openai down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(explainListingFit(facts)).resolves.toEqual({ summary: "", highlights: [] });

    errSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/insight-client.test.ts`
Expected: FAIL — `explainListingFit` is not exported from `./client`.

- [ ] **Step 3: Add the Vertex implementation**

Append to `lib/vertex/client.ts`, and add the import at the top of the file alongside the existing imports:

```ts
import {
  INSIGHT_SYSTEM,
  buildInsightUserText,
  parseInsightJson,
} from "../spaces/insight-prompt";
import type { InsightContent, InsightFacts } from "../spaces/insight-types";
```

Append at the end of the file:

```ts
export async function explainListingFit(facts: InsightFacts): Promise<InsightContent> {
  const token = await getVertexAccessToken();
  const res = await fetch(modelUrl(chatModel(), "generateContent"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: INSIGHT_SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: buildInsightUserText(facts) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
        maxOutputTokens: 320,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`vertex insight failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const content = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";
  return parseInsightJson(content);
}
```

- [ ] **Step 4: Add the OpenAI implementation**

Append to `lib/openai/client.ts`, adding the imports at the top alongside the existing import:

```ts
import {
  INSIGHT_SYSTEM,
  buildInsightUserText,
  parseInsightJson,
} from "../spaces/insight-prompt";
import type { InsightContent, InsightFacts } from "../spaces/insight-types";
```

Append at the end of the file:

```ts
export async function explainListingFit(facts: InsightFacts): Promise<InsightContent> {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: INSIGHT_SYSTEM },
        { role: "user", content: buildInsightUserText(facts) },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`insight failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    choices: { message?: { content?: string | null } }[];
  };
  const content = body.choices[0]?.message?.content?.trim() || "{}";
  return parseInsightJson(content);
}
```

- [ ] **Step 5: Add the facade**

Append to `lib/ai/client.ts`, adding these imports at the top alongside the existing ones:

```ts
import { emptyInsightContent } from "../spaces/insight-prompt";
import type { InsightContent, InsightFacts } from "../spaces/insight-types";
```

Append at the end of the file:

```ts
export async function explainListingFit(facts: InsightFacts): Promise<InsightContent> {
  try {
    return aiProvider() === "vertex"
      ? await vertex.explainListingFit(facts)
      : await openai.explainListingFit(facts);
  } catch (error) {
    console.error("explainListingFit failed", error);
    return emptyInsightContent();
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run lib/ai/`
Expected: PASS — the new insight facade tests plus the existing `client.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add lib/vertex/client.ts lib/openai/client.ts lib/ai/client.ts lib/ai/insight-client.test.ts
git commit -m "feat(ai): add explainListingFit across providers and facade"
```

---

### Task 5: Cache and insight orchestrator

The two-layer cache and the orchestrator that ties category selection, Places, and phrasing together — including graceful nearby degradation and the rule that empty AI content is never cached.

**Files:**
- Create: `lib/spaces/insight-cache.ts`
- Create: `lib/spaces/insight.ts`
- Test: `lib/spaces/insight.test.ts`

**Interfaces:**
- Consumes: `selectNearbyCategories` (Task 1), `isPlacesConfigured`/`searchNearby` (Task 2), `distanceLabel` (Task 2), `explainListingFit` (Task 4), `InsightResponse` (Task 3), `Listing` from `lib/listings/types.ts`, `QueryEntities`/`emptyQueryEntities` from `lib/graph/types.ts`, `normalizeQueryEntities` from `lib/graph/normalize.ts`.
- Produces: `getCached<T>(key: string): T | null`, `setCached<T>(key: string, ttlMs: number, value: T): void`, `cacheKey(namespace: string, parts: string[]): string`, `clearInsightCache(): void`, and `buildInsight(input: { listing: Listing; query: string; entities?: QueryEntities }): Promise<InsightResponse>`.

- [ ] **Step 1: Write the failing test**

Create `lib/spaces/insight.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Listing } from "../listings/types";

vi.mock("../places/client", () => ({
  isPlacesConfigured: vi.fn(() => true),
  searchNearby: vi.fn(),
}));

vi.mock("../ai/client", () => ({
  explainListingFit: vi.fn(),
}));

import { explainListingFit } from "../ai/client";
import { isPlacesConfigured, searchNearby } from "../places/client";
import { clearInsightCache } from "./insight-cache";
import { buildInsight } from "./insight";

const listing: Listing = {
  id: "11111111-1111-1111-1111-111111111111",
  source: "coworker",
  sourceId: "c1",
  slug: "cowrks-ecoworld",
  title: "CoWrks Ecoworld",
  description: "Large shared office",
  shortTeaser: "Large shared office",
  address: "RMZ Ecoworld",
  area: "Bellandur",
  city: "Bengaluru",
  lat: 12.93,
  lng: 77.68,
  amenities: ["WiFi"],
  images: [],
  pricingHint: null,
  propertyType: "Coworking",
  sourceUrl: "https://example.com/cowrks",
  syncedAt: "2026-01-01T00:00:00.000Z",
};

const entities = {
  areas: ["bellandur"],
  amenities: ["coffee"],
  deskTypes: [],
  landmarks: [],
  budgetSignals: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  clearInsightCache();
  vi.mocked(isPlacesConfigured).mockReturnValue(true);
  vi.mocked(explainListingFit).mockResolvedValue({
    summary: "Fits your Bellandur ask.",
    highlights: [{ label: "Cafes", detail: "Third Wave ~300 m" }],
  });
});

afterEach(() => {
  clearInsightCache();
});

describe("buildInsight", () => {
  it("returns grounded highlights and nearby groups", async () => {
    vi.mocked(searchNearby).mockResolvedValue([
      { name: "Third Wave", distanceMeters: 300 },
    ]);

    const insight = await buildInsight({ listing, query: "coffee nearby", entities });

    expect(insight.listingId).toBe(listing.id);
    expect(insight.summary).toBe("Fits your Bellandur ask.");
    expect(insight.highlights).toEqual([{ label: "Cafes", detail: "Third Wave ~300 m" }]);
    expect(insight.nearby).toEqual([
      { category: "cafe", label: "Cafes", places: [{ name: "Third Wave", distanceLabel: "~300 m" }] },
    ]);
  });

  it("reuses both cache layers on a repeat call", async () => {
    vi.mocked(searchNearby).mockResolvedValue([
      { name: "Third Wave", distanceMeters: 300 },
    ]);

    await buildInsight({ listing, query: "coffee nearby", entities });
    await buildInsight({ listing, query: "coffee nearby", entities });

    expect(searchNearby).toHaveBeenCalledTimes(1);
    expect(explainListingFit).toHaveBeenCalledTimes(1);
  });

  it("still returns highlights when the nearby lookup fails", async () => {
    vi.mocked(searchNearby).mockRejectedValue(new Error("places down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const insight = await buildInsight({ listing, query: "coffee nearby", entities });

    expect(insight.nearby).toEqual([]);
    expect(insight.highlights).toHaveLength(1);
    errSpy.mockRestore();
  });

  it("skips the nearby lookup when the listing has no coordinates", async () => {
    const insight = await buildInsight({
      listing: { ...listing, lat: null, lng: null },
      query: "coffee nearby",
      entities,
    });

    expect(searchNearby).not.toHaveBeenCalled();
    expect(insight.nearby).toEqual([]);
  });

  it("does not cache empty AI content", async () => {
    vi.mocked(searchNearby).mockResolvedValue([]);
    vi.mocked(explainListingFit).mockResolvedValue({ summary: "", highlights: [] });

    await buildInsight({ listing, query: "coffee nearby", entities });
    await buildInsight({ listing, query: "coffee nearby", entities });

    expect(explainListingFit).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/spaces/insight.test.ts`
Expected: FAIL — cannot find module `./insight-cache`.

- [ ] **Step 3: Implement the cache**

Create `lib/spaces/insight-cache.ts`:

```ts
type Entry = { value: unknown; expiresAt: number };

// ponytail: process-local cache — ceiling is one Render instance and it is lost on
// restart. Upgrade path: move the nearby namespace to a `listing_nearby` DB table
// if we ever run more than one instance.
const store = new Map<string, Entry>();

export function cacheKey(namespace: string, parts: string[]): string {
  return `${namespace}:${parts.join("|")}`;
}

export function getCached<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return hit.value as T;
}

export function setCached<T>(key: string, ttlMs: number, value: T): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function clearInsightCache(): void {
  store.clear();
}
```

- [ ] **Step 4: Implement the orchestrator**

Create `lib/spaces/insight.ts`:

```ts
import { explainListingFit } from "../ai/client";
import { normalizeQueryEntities } from "../graph/normalize";
import { emptyQueryEntities, type QueryEntities } from "../graph/types";
import type { Listing } from "../listings/types";
import { selectNearbyCategories } from "../places/categories";
import { isPlacesConfigured, searchNearby } from "../places/client";
import { distanceLabel } from "../places/distance";
import type { NearbyCategory, NearbyGroup } from "../places/types";
import { cacheKey, getCached, setCached } from "./insight-cache";
import type { InsightContent, InsightResponse } from "./insight-types";

const NEARBY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const INSIGHT_TTL_MS = 24 * 60 * 60 * 1000;

function querySignature(entities: QueryEntities): string {
  const normalized = normalizeQueryEntities(entities);
  return [
    normalized.areas.join(","),
    normalized.amenities.join(","),
    normalized.deskTypes.join(","),
    normalized.landmarks.join(","),
    normalized.budgetSignals.join(","),
  ].join(";");
}

async function loadNearby(
  listing: Listing,
  categories: NearbyCategory[],
): Promise<NearbyGroup[]> {
  if (listing.lat == null || listing.lng == null) return [];
  if (!isPlacesConfigured()) return [];

  const key = cacheKey("nearby", [listing.id, categories.map((c) => c.key).join(",")]);
  const cached = getCached<NearbyGroup[]>(key);
  if (cached) return cached;

  const origin = { lat: listing.lat, lng: listing.lng };
  const groups: NearbyGroup[] = [];

  for (const category of categories) {
    const places = await searchNearby(origin, category);
    if (places.length === 0) continue;
    groups.push({
      category: category.key,
      label: category.label,
      places: places.map((place) => ({
        name: place.name,
        distanceLabel: distanceLabel(place.distanceMeters),
      })),
    });
  }

  setCached(key, NEARBY_TTL_MS, groups);
  return groups;
}

export async function buildInsight(input: {
  listing: Listing;
  query: string;
  entities?: QueryEntities;
}): Promise<InsightResponse> {
  const entities = input.entities ?? emptyQueryEntities();
  const categories = selectNearbyCategories(entities);

  let nearby: NearbyGroup[] = [];
  try {
    nearby = await loadNearby(input.listing, categories);
  } catch (error) {
    console.error("nearby lookup failed", error);
    nearby = [];
  }

  const key = cacheKey("insight", [
    input.listing.id,
    querySignature(entities),
    String(nearby.length),
  ]);

  let content = getCached<InsightContent>(key);
  if (!content) {
    content = await explainListingFit({
      title: input.listing.title,
      area: input.listing.area,
      city: input.listing.city,
      propertyType: input.listing.propertyType,
      pricingHint: input.listing.pricingHint,
      amenities: input.listing.amenities,
      description: input.listing.description,
      query: input.query,
      nearby,
    });
    if (content.summary || content.highlights.length > 0) {
      setCached(key, INSIGHT_TTL_MS, content);
    }
  }

  return {
    listingId: input.listing.id,
    summary: content.summary,
    highlights: content.highlights,
    nearby,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/spaces/insight.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/spaces/insight-cache.ts lib/spaces/insight.ts lib/spaces/insight.test.ts
git commit -m "feat(spaces): add cached insight orchestrator with nearby degradation"
```

---

### Task 6: Listing lookup by id and the insight API route

Adds the missing DB accessor and the endpoint. UUID shape is validated in the route so malformed ids return 400 instead of blowing up Postgres.

**Files:**
- Modify: `lib/db/listings.ts` (add `getListingById` after `getListingBySlug`, around line 99)
- Create: `app/api/spaces/insight/route.ts`
- Test: `app/api/spaces/insight/route.test.ts`

**Interfaces:**
- Consumes: `buildInsight` (Task 5), `isAiSearchConfigured` from `lib/ai/client.ts`, `rowToListing`/`getPool`/`getListingMissingRunsLimit` already present in `lib/db/listings.ts`.
- Produces: `getListingById(id: string): Promise<Listing | null>` and `POST` handler at `/api/spaces/insight` returning `InsightResponse` or `{ error }`.

- [ ] **Step 1: Write the failing test**

Create `app/api/spaces/insight/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Listing } from "@/lib/listings/types";

vi.mock("@/lib/ai/client", () => ({
  isAiSearchConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/db/listings", () => ({
  getListingById: vi.fn(),
}));

vi.mock("@/lib/spaces/insight", () => ({
  buildInsight: vi.fn(),
}));

import { isAiSearchConfigured } from "@/lib/ai/client";
import { getListingById } from "@/lib/db/listings";
import { buildInsight } from "@/lib/spaces/insight";
import { POST } from "./route";

const LISTING_ID = "11111111-1111-1111-1111-111111111111";

const listing: Listing = {
  id: LISTING_ID,
  source: "coworker",
  sourceId: "c1",
  slug: "cowrks-ecoworld",
  title: "CoWrks Ecoworld",
  description: "Large shared office",
  shortTeaser: "Large shared office",
  address: "RMZ Ecoworld",
  area: "Bellandur",
  city: "Bengaluru",
  lat: 12.93,
  lng: 77.68,
  amenities: ["WiFi"],
  images: [],
  pricingHint: null,
  propertyType: "Coworking",
  sourceUrl: "https://example.com/cowrks",
  syncedAt: "2026-01-01T00:00:00.000Z",
};

function postInsight(body: unknown) {
  return POST(
    new Request("http://localhost/api/spaces/insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAiSearchConfigured).mockReturnValue(true);
});

describe("POST /api/spaces/insight", () => {
  it("returns 503 when AI is not configured", async () => {
    vi.mocked(isAiSearchConfigured).mockReturnValue(false);

    const res = await postInsight({ listingId: LISTING_ID, query: "coffee" });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "insight unavailable" });
  });

  it("returns 400 for a malformed listing id", async () => {
    const res = await postInsight({ listingId: "not-a-uuid", query: "coffee" });

    expect(res.status).toBe(400);
    expect(getListingById).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty query", async () => {
    const res = await postInsight({ listingId: LISTING_ID, query: "  " });

    expect(res.status).toBe(400);
  });

  it("returns 404 when the listing is missing", async () => {
    vi.mocked(getListingById).mockResolvedValue(null);

    const res = await postInsight({ listingId: LISTING_ID, query: "coffee" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("returns the insight payload on success", async () => {
    vi.mocked(getListingById).mockResolvedValue(listing);
    vi.mocked(buildInsight).mockResolvedValue({
      listingId: LISTING_ID,
      summary: "Fits your ask.",
      highlights: [{ label: "Cafes", detail: "Third Wave ~300 m" }],
      nearby: [
        { category: "cafe", label: "Cafes", places: [{ name: "Third Wave", distanceLabel: "~300 m" }] },
      ],
    });

    const res = await postInsight({ listingId: LISTING_ID, query: "coffee nearby" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      listingId: LISTING_ID,
      summary: "Fits your ask.",
      highlights: [{ label: "Cafes", detail: "Third Wave ~300 m" }],
      nearby: [
        { category: "cafe", label: "Cafes", places: [{ name: "Third Wave", distanceLabel: "~300 m" }] },
      ],
    });
  });

  it("returns 502 when the model produced no content", async () => {
    vi.mocked(getListingById).mockResolvedValue(listing);
    vi.mocked(buildInsight).mockResolvedValue({
      listingId: LISTING_ID,
      summary: "",
      highlights: [],
      nearby: [],
    });

    const res = await postInsight({ listingId: LISTING_ID, query: "coffee nearby" });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "insight failed" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/spaces/insight/route.test.ts`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 3: Add the DB accessor**

In `lib/db/listings.ts`, insert immediately after the `getListingBySlug` function (which ends at line 99):

```ts
export async function getListingById(id: string): Promise<Listing | null> {
  if (!process.env.DATABASE_URL) return null;
  const visibleLimit = getListingMissingRunsLimit();

  const { rows } = await getPool().query<ListingRow>(
    "SELECT * FROM listings WHERE id = $1 AND missing_runs < $2 LIMIT 1",
    [id, visibleLimit],
  );

  return rows[0] ? rowToListing(rows[0]) : null;
}
```

- [ ] **Step 4: Write the route**

Create `app/api/spaces/insight/route.ts`:

```ts
import { NextResponse } from "next/server";
import { isAiSearchConfigured } from "@/lib/ai/client";
import { getListingById } from "@/lib/db/listings";
import { buildInsight } from "@/lib/spaces/insight";
import type { QueryEntities } from "@/lib/graph/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  if (!isAiSearchConfigured()) {
    return NextResponse.json({ error: "insight unavailable" }, { status: 503 });
  }

  let body: { listingId?: string; query?: string; entities?: QueryEntities };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const listingId = body.listingId?.trim() ?? "";
  const query = body.query?.trim() ?? "";
  if (!UUID_RE.test(listingId) || !query || query.length > 500) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  try {
    const listing = await getListingById(listingId);
    if (!listing) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const insight = await buildInsight({ listing, query, entities: body.entities });
    if (!insight.summary && insight.highlights.length === 0) {
      return NextResponse.json({ error: "insight failed" }, { status: 502 });
    }

    return NextResponse.json(insight);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "insight failed" }, { status: 502 });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run app/api/spaces/insight/route.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS — all files, no regressions in the existing search route tests.

- [ ] **Step 7: Commit**

```bash
git add lib/db/listings.ts app/api/spaces/insight/route.ts app/api/spaces/insight/route.test.ts
git commit -m "feat(api): add on-demand spaces insight endpoint"
```

---

### Task 7: UI — plumb search entities and add the insight panel

`SpaceCard` stays a server component; the new panel is the only client piece and owns its own button, fetch, and state.

**Files:**
- Create: `components/spaces/SpaceInsightPanel.tsx`
- Modify: `components/spaces/SpaceCard.tsx` (props + render panel)
- Modify: `components/spaces/SpacesBrowseClient.tsx:29-32` (widen `SearchResponse`), `:42-52` (add entities state), `:123-130` (store entities), `:78-95` (reset entities), `:260-269` (pass props to `SpaceCard`)

**Interfaces:**
- Consumes: `InsightResponse` from `lib/spaces/insight-types.ts` (Task 3), `POST /api/spaces/insight` (Task 6), `QueryEntities` from `lib/graph/types.ts`.
- Produces: `<SpaceInsightPanel listingId query entities />` and `SpaceCard` props `searchQuery?: string`, `searchEntities?: QueryEntities`.

- [ ] **Step 1: Create the insight panel component**

Create `components/spaces/SpaceInsightPanel.tsx`:

```tsx
"use client";

import { useCallback, useState } from "react";
import type { QueryEntities } from "@/lib/graph/types";
import type { InsightResponse } from "@/lib/spaces/insight-types";

type SpaceInsightPanelProps = {
  listingId: string;
  query: string;
  entities?: QueryEntities;
};

type PanelState = "idle" | "loading" | "ready" | "error";

export function SpaceInsightPanel({ listingId, query, entities }: SpaceInsightPanelProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PanelState>("idle");
  const [data, setData] = useState<InsightResponse | null>(null);
  const panelId = `insight-${listingId}`;

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/spaces/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, query, entities }),
      });
      if (!res.ok) {
        setState("error");
        return;
      }
      setData((await res.json()) as InsightResponse);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [listingId, query, entities]);

  const handleToggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    if (next && !data && state !== "loading") void load();
  }, [open, data, state, load]);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="text-[13px] font-semibold text-[var(--accent)] transition hover:text-[var(--accent-dark)]"
      >
        {open ? "Hide why this fits" : "Why this fits"}
      </button>

      {open ? (
        <div
          id={panelId}
          className="mt-2 rounded-[var(--radius-sm)] bg-[var(--surface-tint)] px-3 py-3"
        >
          {state === "loading" ? (
            <p className="text-[13px] text-[var(--muted)]">Reading the neighborhood…</p>
          ) : null}

          {state === "error" ? (
            <p className="text-[13px] text-[var(--muted)]">
              Couldn&apos;t generate insight.{" "}
              <button
                type="button"
                onClick={() => void load()}
                className="font-semibold text-[var(--accent)]"
              >
                Retry
              </button>
            </p>
          ) : null}

          {state === "ready" && data ? (
            <div className="flex flex-col gap-3">
              {data.summary ? (
                <p className="text-[13px] leading-[1.45] text-[var(--ink-secondary)]">
                  {data.summary}
                </p>
              ) : null}

              {data.highlights.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {data.highlights.map((highlight) => (
                    <li
                      key={`${highlight.label}-${highlight.detail}`}
                      className="rounded-full bg-[var(--bg)] px-2.5 py-1 text-[11px] text-[var(--ink-secondary)]"
                    >
                      <span className="font-semibold">{highlight.label}</span> · {highlight.detail}
                    </li>
                  ))}
                </ul>
              ) : null}

              {data.nearby.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {data.nearby.map((group) => (
                    <p key={group.category} className="text-[12px] text-[var(--muted)]">
                      <span className="font-semibold text-[var(--ink-secondary)]">
                        {group.label}
                      </span>{" "}
                      ·{" "}
                      {group.places
                        .map((place) => `${place.name} ${place.distanceLabel}`)
                        .join(", ")}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Wire the panel into SpaceCard**

In `components/spaces/SpaceCard.tsx`, add these imports below the existing ones:

```tsx
import type { QueryEntities } from "@/lib/graph/types";
import { SpaceInsightPanel } from "./SpaceInsightPanel";
```

Replace the `SpaceCardProps` type with:

```tsx
type SpaceCardProps = {
  listing: Listing;
  active?: boolean;
  onActivate?: (id: string) => void;
  searchQuery?: string;
  searchEntities?: QueryEntities;
};
```

Update the component signature:

```tsx
export function SpaceCard({
  listing,
  active = false,
  onActivate,
  searchQuery,
  searchEntities,
}: SpaceCardProps) {
```

Then, inside the content `div`, insert the panel immediately after the source-label `<span>` (the last element before the closing `</div>`):

```tsx
        {searchQuery ? (
          <SpaceInsightPanel
            listingId={listing.id}
            query={searchQuery}
            entities={searchEntities}
          />
        ) : null}
```

The spec's "expanding sets the card active so its map pin emphasizes" needs no new code: the
`<article>` in `SpaceCard` already has `onFocusCapture={() => onActivate?.(listing.id)}`, which
fires when the panel's button receives focus on click. Do not add a second activation path.

- [ ] **Step 3: Plumb entities through SpacesBrowseClient**

In `components/spaces/SpacesBrowseClient.tsx`:

Add the import next to the existing type import:

```tsx
import type { QueryEntities } from "@/lib/graph/types";
```

Widen `SearchResponse` (currently lines 29-32):

```tsx
type SearchResponse = {
  interpretedQuery: string;
  listings: Listing[];
  matchedEntities?: QueryEntities;
};
```

Add state beside the other `useState` calls (after the `interpretedQuery` state on line 44):

```tsx
  const [searchEntities, setSearchEntities] = useState<QueryEntities | undefined>(undefined);
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
```

In `runSearch`, after `setInterpretedQuery(data.interpretedQuery);` (line 125):

```tsx
      setSearchEntities(data.matchedEntities);
      setActiveQuery(trimmed);
```

In `handleClear` (after line 80) and in `restoreSyncCatalog` (after line 92), reset both:

```tsx
    setSearchEntities(undefined);
    setActiveQuery(null);
```

In the results grid (lines 261-269), pass the props:

```tsx
                    <SpaceCard
                      listing={listing}
                      active={listing.id === activeId}
                      onActivate={handleCardActivate}
                      searchQuery={activeQuery ?? undefined}
                      searchEntities={searchEntities}
                    />
```

- [ ] **Step 4: Verify types and the suite still pass**

Run: `npx tsc --noEmit`
Expected: no NEW errors introduced by these files. (The repo has pre-existing errors unrelated to this work — compare against `git stash` if unsure.)

Run: `npm test`
Expected: PASS — no regressions.

- [ ] **Step 5: Commit**

```bash
git add components/spaces/SpaceInsightPanel.tsx components/spaces/SpaceCard.tsx components/spaces/SpacesBrowseClient.tsx
git commit -m "feat(spaces): add on-demand why-this-fits panel to search results"
```

---

### Task 8: Config, live check script, and documentation

Wires the new env var, adds the runnable end-to-end check in the style of `graph:check`, and records the feature in project docs.

**Files:**
- Modify: `.env.example`
- Modify: `package.json` (scripts)
- Create: `scripts/check-insight.ts`
- Modify: `README.md`
- Modify: `openmemory.md`

**Interfaces:**
- Consumes: `buildInsight` (Task 5), `listListings` from `lib/db/listings.ts`.
- Produces: `npm run insight:check`.

- [ ] **Step 1: Add the env var**

Append to `.env.example`:

```
GOOGLE_PLACES_API_KEY=
```

- [ ] **Step 2: Add the script entry**

In `package.json`, add to `scripts` after the `graph:check` line (remember to add a comma to the previous line):

```json
    "insight:check": "tsx --env-file=.env.local scripts/check-insight.ts"
```

- [ ] **Step 3: Write the live check script**

Create `scripts/check-insight.ts`:

```ts
import { listListings } from "../lib/db/listings";
import { buildInsight } from "../lib/spaces/insight";

async function main(): Promise<void> {
  const listings = await listListings();
  const listing =
    listings.find(
      (l) => l.lat != null && l.area?.toLowerCase().includes("bellandur"),
    ) ?? listings.find((l) => l.lat != null);

  if (!listing) {
    console.error("insight check failed: no listing with coordinates; run a sync first");
    process.exit(1);
  }

  const insight = await buildInsight({
    listing,
    query: "coworking near metro with coffee nearby",
    entities: {
      areas: [],
      amenities: ["coffee"],
      deskTypes: [],
      landmarks: ["metro"],
      budgetSignals: [],
    },
  });

  if (insight.highlights.length === 0) {
    console.error(`insight check failed: no highlights for ${listing.slug}`);
    process.exit(1);
  }

  const nearbyCount = insight.nearby.reduce((total, group) => total + group.places.length, 0);
  console.log(
    `insight ok: ${listing.slug}; highlights=${insight.highlights.length}, nearby places=${nearbyCount}`,
  );

  if (nearbyCount === 0) {
    console.warn(
      "warning: no nearby places returned — check that GOOGLE_PLACES_API_KEY allows Places API (New)",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

- [ ] **Step 4: Run the live check**

Run: `npm run insight:check`
Expected: `insight ok: <slug>; highlights=N, nearby places=M` with `N >= 1`. If it warns about zero nearby places, verify the API key's restrictions allow Places API (New).

- [ ] **Step 5: Update the README**

In `README.md`, add to the scripts/commands list:

```markdown
- `npm run insight:check` — live check for the AI search "Why this fits" panel: builds one insight (Places + Gemini) for a known listing and asserts non-empty highlights.
```

And add a short feature note near the AI search description:

```markdown
AI search results expose an on-demand **"Why this fits"** panel. Expanding a result calls
`POST /api/spaces/insight`, which selects nearby categories from the search's extracted
entities, queries Google Places API (New) around the listing's real coordinates, and asks
Gemini to phrase query-relevant highlights using only those facts. Requires
`GOOGLE_PLACES_API_KEY`; nearby lookup is best-effort and degrades to highlights only.
```

- [ ] **Step 6: Update project memory**

In `openmemory.md`, add to **Architecture**:

```markdown
- **Search insight**: `POST /api/spaces/insight` — on-demand "Why this fits" per result; Places API (New) nearby lookup around real coords + Gemini phrasing, both cached.
```

Add to **Components** table:

```markdown
| Search insight | `app/api/spaces/insight/route.ts`, `lib/spaces/insight*.ts`, `lib/places/*`, `components/spaces/SpaceInsightPanel.tsx` |
```

Add to **Patterns**:

```markdown
- `buildInsight()` caches two layers: query-independent nearby (`listingId|categories`, 30d) and per-query phrasing (`listingId|querySignature|nearbyCount`, 24h); empty AI content is never cached. Nearby failures degrade to highlights-only, and the client only ever receives place names + coarse distance labels (never exact addresses).
- `selectNearbyCategories()` maps query entities to Places `includedTypes` deterministically (max 3, stable order for cache-key stability) with a transit/food/ATM commuter default.
```

- [ ] **Step 7: Run the full suite one last time**

Run: `npm test`
Expected: PASS — all tests.

- [ ] **Step 8: Commit**

```bash
git add .env.example package.json scripts/check-insight.ts README.md openmemory.md
git commit -m "chore(spaces): add insight live check, config and docs"
```

---

## Verification checklist

- [ ] `npm test` passes.
- [ ] `npm run insight:check` prints `insight ok:` with at least one highlight.
- [ ] In the browser on `/spaces`: run an AI search, expand "Why this fits" on a result, confirm the summary, highlight chips, and nearby list render; confirm the button is **absent** in plain browse mode (before searching).
- [ ] Collapse and re-expand the same card — no second network request (payload is held in component state).
- [ ] Temporarily unset `GOOGLE_PLACES_API_KEY` and confirm the panel still renders highlights without a nearby section.
