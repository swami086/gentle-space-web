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
