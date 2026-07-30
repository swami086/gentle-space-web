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
import { buildInsight, insightFingerprint } from "./insight";

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

  it("deduplicates concurrent cache misses to one Places and one AI call", async () => {
    vi.mocked(searchNearby).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([{ name: "Third Wave", distanceMeters: 300 }]), 20)),
    );
    vi.mocked(explainListingFit).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({
        summary: "Fits your Bellandur ask.",
        highlights: [{ label: "Cafes", detail: "Third Wave ~300 m" }],
      }), 20)),
    );

    await Promise.all([
      buildInsight({ listing, query: "coffee nearby", entities }),
      buildInsight({ listing, query: "coffee nearby", entities }),
    ]);

    expect(searchNearby).toHaveBeenCalledTimes(1);
    expect(explainListingFit).toHaveBeenCalledTimes(1);
  });

  it("still returns highlights when the nearby lookup fails", async () => {
    vi.mocked(searchNearby).mockRejectedValue(new Error("places down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const insight = await buildInsight({ listing, query: "coffee nearby", entities });

    expect(insight.nearby).toEqual([]);
    expect(insight.highlights).toHaveLength(1);

    vi.mocked(searchNearby).mockResolvedValue([{ name: "Third Wave", distanceMeters: 300 }]);
    const retry = await buildInsight({ listing, query: "coffee nearby", entities });
    expect(retry.nearby).toHaveLength(1);
    expect(searchNearby).toHaveBeenCalledTimes(2);

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
    expect(searchNearby).toHaveBeenCalledTimes(1);
  });

  it("reuses insight cache when entity list order differs", async () => {
    vi.mocked(searchNearby).mockResolvedValue([
      { name: "Third Wave", distanceMeters: 300 },
    ]);

    const orderA = {
      ...entities,
      amenities: ["coffee", "gym"],
    };
    const orderB = {
      ...entities,
      amenities: ["gym", "coffee"],
    };

    await buildInsight({ listing, query: "coffee nearby", entities: orderA });
    await buildInsight({ listing, query: "coffee nearby", entities: orderB });

    expect(explainListingFit).toHaveBeenCalledTimes(1);
  });

  it("calls AI again when raw query differs even with identical entities", async () => {
    vi.mocked(searchNearby).mockResolvedValue([
      { name: "Third Wave", distanceMeters: 300 },
    ]);

    await buildInsight({ listing, query: "coffee nearby", entities });
    await buildInsight({ listing, query: "COFFEE   nearby", entities });

    expect(explainListingFit).toHaveBeenCalledTimes(1);

    await buildInsight({ listing, query: "tea nearby", entities });
    expect(explainListingFit).toHaveBeenCalledTimes(2);
  });

  it("calls AI again when listing facts change for the same id", async () => {
    vi.mocked(searchNearby).mockResolvedValue([
      { name: "Third Wave", distanceMeters: 300 },
    ]);

    await buildInsight({ listing, query: "coffee nearby", entities });
    await buildInsight({
      listing: { ...listing, title: "CoWrks Ecoworld Phase 2" },
      query: "coffee nearby",
      entities,
    });

    expect(explainListingFit).toHaveBeenCalledTimes(2);
  });

  it("returns summary and highlights without calling Places when unconfigured", async () => {
    vi.mocked(isPlacesConfigured).mockReturnValue(false);

    const insight = await buildInsight({ listing, query: "coffee nearby", entities });

    expect(searchNearby).not.toHaveBeenCalled();
    expect(insight.highlights).toHaveLength(1);
    expect(insight.nearby).toEqual([]);
  });
});

describe("insightFingerprint", () => {
  const baseListing = {
    title: listing.title,
    area: listing.area,
    city: listing.city,
    propertyType: listing.propertyType,
    pricingHint: listing.pricingHint,
    amenities: listing.amenities,
    description: listing.description,
  };

  it("is deterministic for equivalent normalized inputs", () => {
    const nearby = [
      {
        category: "cafe",
        label: "Cafes",
        places: [{ name: "Third Wave", distanceLabel: "~300 m" }],
      },
    ];
    const a = insightFingerprint({
      query: " COFFEE   nearby ",
      entities,
      listing: baseListing,
      nearby,
    });
    const b = insightFingerprint({
      query: "coffee nearby",
      entities: { ...entities, amenities: ["coffee"] },
      listing: baseListing,
      nearby: [
        {
          category: "cafe",
          label: "Cafes",
          places: [{ name: "Third Wave", distanceLabel: "~300 m" }],
        },
      ],
    });
    expect(a).toBe(b);
  });

  it("keeps delimiter-like field values distinct (no pre-hash collision)", () => {
    const nearby: never[] = [];
    const fp1 = insightFingerprint({
      query: "x",
      entities,
      listing: { ...baseListing, title: "a", area: "\u001ebar" },
      nearby,
    });
    const fp2 = insightFingerprint({
      query: "x\u0000extra",
      entities,
      listing: { ...baseListing, title: "a", area: "bar" },
      nearby,
    });
    const fp3 = insightFingerprint({
      query: "x",
      entities,
      listing: { ...baseListing, title: "a\u001e", area: "bar" },
      nearby,
    });

    expect(fp1).not.toBe(fp3);
    expect(fp2).not.toBe(fp1);
    expect(fp2).not.toBe(fp3);
  });
});
