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
  pricingHint: "price on request",
  lat: 12.91,
  lng: 77.64,
  syncedAt: "2026-07-31T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.ENRICH_DISABLED;
  delete process.env.ENRICH_WEB_LIMIT;
  delete process.env.ENRICH_COOLDOWN_DAYS;
  vi.mocked(listRecentlyAcceptedEnrichmentIds).mockResolvedValue(new Map());
  vi.mocked(applyListingEnrichment).mockResolvedValue();
  vi.mocked(insertEnrichmentLog).mockResolvedValue();
});

describe("enrichListings", () => {
  it("no-ops when ENRICH_DISABLED=1", async () => {
    process.env.ENRICH_DISABLED = "1";

    await expect(enrichListings()).resolves.toEqual({
      scanned: 0,
      queued: 0,
      pageAccepted: 0,
      webAccepted: 0,
      skippedCooldown: 0,
    });
    expect(listEnrichmentCandidates).not.toHaveBeenCalled();
  });

  it("runs Pass 1, writes gated location, skips healthy rows, and logs attempts", async () => {
    vi.mocked(listEnrichmentCandidates).mockResolvedValue([
      weakEmpty,
      { ...weakEmpty, id: "2", sourceUrl: "https://ex.com/2", area: "HSR Layout", address: "x", pricingHint: "₹20,000/month" },
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

    const result = await enrichListings({ webLimit: 0 });

    expect(result).toEqual({
      scanned: 2,
      queued: 1,
      pageAccepted: 1,
      webAccepted: 0,
      skippedCooldown: 0,
    });
    expect(applyListingEnrichment).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({ area: "Koramangala", address: "", locationChanged: true, priceChanged: false }),
    );
    expect(insertEnrichmentLog).toHaveBeenCalledWith(
      expect.objectContaining({ listingId: "1", pass: "page", accepted: true }),
    );
    expect(firecrawlExtract).toHaveBeenCalledTimes(1);
    expect(firecrawlExtract).toHaveBeenCalledWith(["https://ex.com/1"], { enableWebSearch: false });
  });

  it("skips cooldown when last accept is at or after syncedAt", async () => {
    vi.mocked(listEnrichmentCandidates).mockResolvedValue([weakEmpty]);
    vi.mocked(listRecentlyAcceptedEnrichmentIds).mockResolvedValue(
      new Map([["1", "2026-07-31T00:00:00.000Z"]]),
    );

    const result = await enrichListings();

    expect(result.skippedCooldown).toBe(1);
    expect(firecrawlExtract).not.toHaveBeenCalled();
  });

  it("dryRun logs accepted attempts but does not apply writes", async () => {
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
    expect(insertEnrichmentLog).toHaveBeenCalledWith(
      expect.objectContaining({ listingId: "1", pass: "page", accepted: true }),
    );
  });

  it("runs Pass 2 for misses and accepts low-confidence locality on agreement with Pass 1", async () => {
    vi.mocked(listEnrichmentCandidates).mockResolvedValue([weakEmpty]);
    vi.mocked(firecrawlExtract)
      .mockResolvedValueOnce(
        new Map([
          [
            "https://ex.com/1",
            {
              locality: "Koramangala",
              address: null,
              monthly_price_inr: null,
              price_basis: null,
              brand_match: true,
              confidence: "low",
              evidence: "page",
            },
          ],
        ]),
      )
      .mockResolvedValueOnce(
        new Map([
          [
            "https://ex.com/1",
            {
              locality: "Koramangala",
              address: null,
              monthly_price_inr: 18000,
              price_basis: "from",
              brand_match: true,
              confidence: "low",
              evidence: "web",
            },
          ],
        ]),
      );

    const result = await enrichListings({ webLimit: 10 });

    expect(result.pageAccepted).toBe(0);
    expect(result.webAccepted).toBe(1);
    expect(firecrawlExtract).toHaveBeenNthCalledWith(2, ["https://ex.com/1"], { enableWebSearch: true });
    expect(applyListingEnrichment).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({
        area: "Koramangala",
        locationChanged: true,
        priceChanged: false,
      }),
    );
    expect(insertEnrichmentLog).toHaveBeenLastCalledWith(
      expect.objectContaining({ listingId: "1", pass: "web", accepted: true }),
    );
  });

  it("uses the gated Pass 1 locality for Pass 2 agreement when Pass 1 locality is null", async () => {
    vi.mocked(listEnrichmentCandidates).mockResolvedValue([weakEmpty]);
    vi.mocked(firecrawlExtract)
      .mockResolvedValueOnce(
        new Map([
          [
            "https://ex.com/1",
            {
              locality: null,
              address: "2nd Floor, #108, 27th Main, HSR Layout, Bengaluru, Karnataka 560102, India",
              monthly_price_inr: null,
              price_basis: null,
              brand_match: true,
              confidence: "medium",
              evidence: "page",
            },
          ],
        ]),
      )
      .mockResolvedValueOnce(
        new Map([
          [
            "https://ex.com/1",
            {
              locality: "HSR Layout",
              address: null,
              monthly_price_inr: null,
              price_basis: null,
              brand_match: true,
              confidence: "low",
              evidence: "web",
            },
          ],
        ]),
      );

    const result = await enrichListings({ webLimit: 10 });

    expect(result.pageAccepted).toBe(1);
    expect(result.webAccepted).toBe(1);
    expect(applyListingEnrichment).toHaveBeenNthCalledWith(
      1,
      "1",
      expect.objectContaining({
        area: "HSR Layout",
        address: "2nd Floor, #108, 27th Main, HSR Layout, Bengaluru, Karnataka 560102, India",
        locationChanged: true,
        priceChanged: false,
      }),
    );
    expect(applyListingEnrichment).toHaveBeenNthCalledWith(
      2,
      "1",
      expect.objectContaining({
        area: "HSR Layout",
        address: "",
        locationChanged: true,
        priceChanged: false,
      }),
    );
  });

  it("updates the in-memory candidate after Pass 1 so Pass 2 only queues remaining weak fields", async () => {
    vi.mocked(listEnrichmentCandidates).mockResolvedValue([weakEmpty]);
    vi.mocked(firecrawlExtract)
      .mockResolvedValueOnce(
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
      )
      .mockResolvedValueOnce(
        new Map([
          [
            "https://ex.com/1",
            {
              locality: "Bangalore",
              address: null,
              monthly_price_inr: 22000,
              price_basis: "exact",
              brand_match: true,
              confidence: "medium",
              evidence: null,
            },
          ],
        ]),
      );

    const result = await enrichListings({ webLimit: 10 });

    expect(result.pageAccepted).toBe(1);
    expect(result.webAccepted).toBe(1);
    expect(applyListingEnrichment).toHaveBeenNthCalledWith(
      1,
      "1",
      expect.objectContaining({ area: "Koramangala", locationChanged: true, priceChanged: false }),
    );
    expect(applyListingEnrichment).toHaveBeenNthCalledWith(
      2,
      "1",
      expect.objectContaining({
        pricingHint: "₹22,000/month",
        locationChanged: false,
        priceChanged: true,
      }),
    );
  });
});
