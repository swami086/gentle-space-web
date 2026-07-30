import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COFYND_INDEX_URL,
  cofyndAdapter,
  extractCofyndDetailUrls,
  isCofyndDetailUrl,
  parseCofyndDetail,
} from "./cofynd";

vi.mock("@/lib/firecrawl/client", () => ({
  firecrawlMap: vi.fn(),
  firecrawlScrape: vi.fn(),
}));

import { firecrawlMap, firecrawlScrape } from "@/lib/firecrawl/client";

const workhomeFixture = `# WorkHome

4.9 | Koramangala, Bangalore

![WorkHome](https://cofynd.com/images/workhome-hero.jpg)

##### Premium Coworking

## WorkHome

WorkHome Koramangala, Bangalore, offers a premium workspace with top-notch amenities and a supportive community. It is perfect for freelancers, startups, and businesses of all sizes.

- High-speed WiFi
- Meeting rooms
- Pantry

## WorkHome Location

Koramangala, Bangalore

₹6,999/*

12.9352, 77.6245
`;

describe("isCofyndDetailUrl", () => {
  it("accepts coworking detail slugs", () => {
    expect(isCofyndDetailUrl("https://cofynd.com/coworking/workhome")).toBe(true);
    expect(isCofyndDetailUrl("https://cofynd.com/coworking/awfis-residency-road/")).toBe(true);
  });

  it("rejects city index pages", () => {
    expect(isCofyndDetailUrl(COFYND_INDEX_URL)).toBe(false);
    expect(isCofyndDetailUrl("https://cofynd.com/coworking/mumbai")).toBe(false);
  });

  it("rejects nested location pages", () => {
    expect(isCofyndDetailUrl("https://cofynd.com/coworking/bangalore/koramangala")).toBe(false);
  });
});

describe("extractCofyndDetailUrls", () => {
  it("dedupes and canonicalizes detail links", () => {
    const urls = extractCofyndDetailUrls([
      "https://cofynd.com/coworking/workhome",
      "https://cofynd.com/coworking/workhome/",
      "https://cofynd.com/coworking/bangalore",
      "https://cofynd.com/coworking/indiqube-omega",
    ]);
    expect(urls).toEqual([
      "https://cofynd.com/coworking/workhome",
      "https://cofynd.com/coworking/indiqube-omega",
    ]);
  });
});

describe("parseCofyndDetail", () => {
  it("parses markdown fixture into RawListing", () => {
    const listing = parseCofyndDetail(
      workhomeFixture,
      "https://cofynd.com/coworking/workhome",
    );

    expect(listing).toMatchObject({
      source: "cofynd",
      sourceId: "workhome",
      title: "WorkHome",
      area: "Koramangala",
      city: "Bengaluru",
      address: "Koramangala, Bangalore",
      pricingHint: "₹6,999/*",
      propertyType: "Premium Coworking",
      sourceUrl: "https://cofynd.com/coworking/workhome",
      lat: 12.9352,
      lng: 77.6245,
    });
    expect(listing?.description).toContain("premium workspace");
    expect(listing?.shortTeaser).toContain("premium workspace");
    expect(listing?.images).toContain("https://cofynd.com/images/workhome-hero.jpg");
    expect(listing?.amenities).toEqual(
      expect.arrayContaining(["High-speed WiFi", "Meeting rooms"]),
    );
  });

  it("returns null for non-detail URLs", () => {
    expect(parseCofyndDetail(workhomeFixture, COFYND_INDEX_URL)).toBeNull();
  });
});

describe("cofyndAdapter.fetchAll", () => {
  beforeEach(() => {
    vi.mocked(firecrawlMap).mockReset();
    vi.mocked(firecrawlScrape).mockReset();
  });

  it("discovers detail URLs and scrapes each page", async () => {
    vi.mocked(firecrawlMap).mockResolvedValue([
      "https://cofynd.com/coworking/workhome",
      "https://cofynd.com/coworking/bangalore",
    ]);
    vi.mocked(firecrawlScrape).mockImplementation(async (url: string) => {
      if (url === COFYND_INDEX_URL) {
        return { markdown: "[IndiQube](https://cofynd.com/coworking/indiqube-omega)", links: [] };
      }
      if (url === "https://cofynd.com/coworking/workhome") {
        return { markdown: workhomeFixture, links: [] };
      }
      if (url === "https://cofynd.com/coworking/indiqube-omega") {
        return {
          markdown: `# IndiQube Omega\n\n4.0 | Brookefield, Bangalore\n\n## IndiQube Omega\n\nBrookefield workspace.\n\n## IndiQube Omega Location\n\nBrookefield, Bangalore`,
          links: [],
        };
      }
      return { markdown: "", links: [] };
    });

    const listings = await cofyndAdapter.fetchAll();

    expect(cofyndAdapter.source).toBe("cofynd");
    expect(firecrawlMap).toHaveBeenCalledWith(COFYND_INDEX_URL);
    expect(firecrawlScrape).toHaveBeenCalledWith(COFYND_INDEX_URL);
    expect(listings).toHaveLength(2);
    expect(listings.map((l) => l.sourceId).sort()).toEqual(["indiqube-omega", "workhome"]);
  });

  it("throws when no detail URLs are discovered", async () => {
    vi.mocked(firecrawlMap).mockResolvedValue(["https://cofynd.com/coworking/bangalore"]);
    vi.mocked(firecrawlScrape).mockResolvedValue({ markdown: "city index only", links: [] });

    await expect(cofyndAdapter.fetchAll()).rejects.toThrow(/no detail URLs/);
  });
});
