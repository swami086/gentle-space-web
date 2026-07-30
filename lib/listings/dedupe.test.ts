import { describe, expect, it } from "vitest";
import { dedupeListings } from "./dedupe";
import type { Listing } from "./types";

const base = (over: Partial<Listing>): Listing => ({
  id: "1",
  source: "coworker",
  sourceId: "a",
  slug: "x",
  title: "WeWork Prestige",
  description: "",
  shortTeaser: "",
  address: "",
  area: "Koramangala",
  city: "Bengaluru",
  lat: 12.93,
  lng: 77.62,
  amenities: [],
  images: [],
  pricingHint: null,
  propertyType: null,
  sourceUrl: "https://example.com",
  syncedAt: new Date().toISOString(),
  ...over,
});

describe("dedupeListings", () => {
  it("keeps higher priority source", () => {
    const out = dedupeListings([
      base({ source: "gofloaters", sourceId: "g1", title: "WeWork Prestige" }),
      base({ id: "2", source: "coworker", sourceId: "c1", title: "WeWork Prestige" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("coworker");
  });

  it("dedupes by normalized name when both coords are null", () => {
    const out = dedupeListings([
      base({
        source: "cofynd",
        sourceId: "f1",
        title: "WeWork  Prestige!",
        lat: null,
        lng: null,
      }),
      base({
        id: "2",
        source: "myhq",
        sourceId: "m1",
        title: "wework prestige",
        lat: null,
        lng: null,
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("myhq");
  });

  it("dedupes when haversine distance is under 150m", () => {
    const out = dedupeListings([
      base({ source: "gofloaters", sourceId: "g1", lat: 12.93, lng: 77.62 }),
      base({
        id: "2",
        source: "coworker",
        sourceId: "c1",
        lat: 12.9305,
        lng: 77.6205,
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("coworker");
  });

  it("keeps both when same name but far apart", () => {
    const out = dedupeListings([
      base({ source: "coworker", sourceId: "c1", lat: 12.93, lng: 77.62 }),
      base({
        id: "2",
        source: "myhq",
        sourceId: "m1",
        lat: 13.0,
        lng: 77.7,
      }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("keeps both when names differ", () => {
    const out = dedupeListings([
      base({ source: "coworker", sourceId: "c1", title: "WeWork Prestige" }),
      base({
        id: "2",
        source: "myhq",
        sourceId: "m1",
        title: "91Springboard",
        lat: 12.93,
        lng: 77.62,
      }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("does not dedupe when one has coords and other is null", () => {
    const out = dedupeListings([
      base({ source: "coworker", sourceId: "c1", lat: 12.93, lng: 77.62 }),
      base({
        id: "2",
        source: "myhq",
        sourceId: "m1",
        lat: null,
        lng: null,
      }),
    ]);
    expect(out).toHaveLength(2);
  });
});
