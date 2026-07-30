import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COWORKER_LIST_BASE,
  coworkerAdapter,
  extractCoworkerDetailUrls,
  isCoworkerDetailUrl,
  parseCoworkerDetail,
} from "./coworker";

vi.mock("@/lib/firecrawl/client", () => ({
  firecrawlScrape: vi.fn(),
}));

import { firecrawlScrape } from "@/lib/firecrawl/client";

const listFixture = `# Coworking Spaces in Bengaluru

367 results

[CoWrks Ecoworld in Bengaluru](https://www.coworker.com/india/bengaluru/cowrks-ecoworld)

Coworking Space

from ₹
8499

/month

[Regus - Bangalore World Trade Centre in Bengaluru](https://www.coworker.com/india/bengaluru/regus-bangalore-world-trade-centre)
`;

const detailFixture = `## Coworking Space Amenities

- ![WiFi amenity icon](https://d2w68ocb6l47bj.cloudfront.net/v20251122/_redesign/img/wifi.svg)
WiFi
- ![Air Conditioning amenity icon](https://d2w68ocb6l47bj.cloudfront.net/v20251122/_redesign/img/ac.svg)
Air Conditioning

Bellandur, Bengaluru, Karnataka 560103, India

## Overview of CoWrks Ecoworld

CoWrks is a large format shared office space located at RMZ Ecoworld, Bellandur, Bangalore.

## Pricing Plans

Coworking SpacePrivate Office

### Monthly

₹ 20000

price / person

[![CoWrks Ecoworld image 1](https://coworker.imgix.net/photos/india/bengaluru/cowrks-ecoworld/main-1489041240.jpg?w=360&h=206)]
`;

describe("isCoworkerDetailUrl", () => {
  it("accepts Bengaluru detail slugs", () => {
    expect(isCoworkerDetailUrl("https://www.coworker.com/india/bengaluru/cowrks-ecoworld")).toBe(
      true,
    );
    expect(
      isCoworkerDetailUrl("https://www.coworker.com/india/bengaluru/regus-bangalore-hosur-road/"),
    ).toBe(true);
  });

  it("rejects city index and virtual office links", () => {
    expect(isCoworkerDetailUrl(COWORKER_LIST_BASE)).toBe(false);
    expect(isCoworkerDetailUrl("https://www.coworker.com/virtual-offices/india/bengaluru")).toBe(
      false,
    );
    expect(isCoworkerDetailUrl("https://www.coworker.com/india/mumbai/wework")).toBe(false);
  });
});

describe("extractCoworkerDetailUrls", () => {
  it("dedupes and canonicalizes detail links", () => {
    const urls = extractCoworkerDetailUrls([
      "https://www.coworker.com/india/bengaluru/cowrks-ecoworld",
      "https://www.coworker.com/india/bengaluru/cowrks-ecoworld/",
      COWORKER_LIST_BASE,
      "https://www.coworker.com/india/bengaluru/regus-bangalore-world-trade-centre",
    ]);
    expect(urls).toEqual([
      "https://www.coworker.com/india/bengaluru/cowrks-ecoworld",
      "https://www.coworker.com/india/bengaluru/regus-bangalore-world-trade-centre",
    ]);
  });
});

describe("parseCoworkerDetail", () => {
  it("parses markdown fixture into RawListing", () => {
    const listing = parseCoworkerDetail(
      detailFixture,
      "https://www.coworker.com/india/bengaluru/cowrks-ecoworld",
    );

    expect(listing).toMatchObject({
      source: "coworker",
      sourceId: "cowrks-ecoworld",
      title: "CoWrks Ecoworld",
      area: "Bellandur",
      city: "Bengaluru",
      address: "Bellandur, Bengaluru, Karnataka 560103, India",
      pricingHint: "₹ 20000/month",
      propertyType: "Coworking Space",
      sourceUrl: "https://www.coworker.com/india/bengaluru/cowrks-ecoworld",
      lat: null,
      lng: null,
    });
    expect(listing?.description).toContain("large format shared office space");
    expect(listing?.shortTeaser).toContain("large format shared office space");
    expect(listing?.images).toContain(
      "https://coworker.imgix.net/photos/india/bengaluru/cowrks-ecoworld/main-1489041240.jpg",
    );
    expect(listing?.amenities).toEqual(expect.arrayContaining(["WiFi", "Air Conditioning"]));
  });

  it("returns null for non-detail URLs", () => {
    expect(parseCoworkerDetail(detailFixture, COWORKER_LIST_BASE)).toBeNull();
  });
});

describe("coworkerAdapter.fetchAll", () => {
  beforeEach(() => {
    vi.mocked(firecrawlScrape).mockReset();
  });

  it("paginates list pages and scrapes each detail URL", async () => {
    vi.mocked(firecrawlScrape).mockImplementation(async (url: string) => {
      if (url === COWORKER_LIST_BASE) {
        return { markdown: listFixture, links: [] };
      }
      if (url === `${COWORKER_LIST_BASE}?page=2`) {
        return { markdown: "no new listings", links: [] };
      }
      if (url === "https://www.coworker.com/india/bengaluru/cowrks-ecoworld") {
        return { markdown: detailFixture, links: [] };
      }
      if (url === "https://www.coworker.com/india/bengaluru/regus-bangalore-world-trade-centre") {
        return {
          markdown: `## Overview of Regus World Trade Centre\n\nPrestige workspace in Bengaluru.\n\nMG Road, Bengaluru, Karnataka 560001, India`,
          links: [],
        };
      }
      return { markdown: "", links: [] };
    });

    const listings = await coworkerAdapter.fetchAll();

    expect(coworkerAdapter.source).toBe("coworker");
    expect(firecrawlScrape).toHaveBeenCalledWith(COWORKER_LIST_BASE);
    expect(firecrawlScrape).toHaveBeenCalledWith(`${COWORKER_LIST_BASE}?page=2`);
    expect(listings).toHaveLength(2);
    expect(listings.map((l) => l.sourceId).sort()).toEqual([
      "cowrks-ecoworld",
      "regus-bangalore-world-trade-centre",
    ]);
  });

  it("throws when no detail URLs are discovered", async () => {
    vi.mocked(firecrawlScrape).mockResolvedValue({ markdown: "empty city page", links: [] });

    await expect(coworkerAdapter.fetchAll()).rejects.toThrow(/no detail URLs/);
  });
});
