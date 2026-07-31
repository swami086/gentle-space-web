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
  it("takes area from the locality, not the leading address fragment", () => {
    // Regression: `area` used to be `address.split(",")[0]`, which yielded
    // "2nd & 3rd Floor" for this real address and then geocoded to the wrong place.
    const markdown = `## Overview of Hustlehub Tech Park

A workspace in south Bengaluru.

2nd & 3rd Floor, #108, Opposite Corner House, 27th Main Road, Sector 2, HSR Layout, Bengaluru, Karnataka 560102, India
`;
    const listing = parseCoworkerDetail(
      markdown,
      "https://www.coworker.com/india/bengaluru/hustlehub-tech-park",
    );

    expect(listing?.area).toBe("HSR Layout");
    expect(listing?.address).toBe(
      "2nd & 3rd Floor, #108, Opposite Corner House, 27th Main Road, Sector 2, HSR Layout, Bengaluru, Karnataka 560102, India",
    );
  });

  it("leaves area empty rather than guessing when the address has no locality", () => {
    const markdown = `## Overview of Nameless Space

Somewhere.

Bengaluru, Karnataka 560001, India
`;
    const listing = parseCoworkerDetail(
      markdown,
      "https://www.coworker.com/india/bengaluru/nameless-space",
    );

    expect(listing?.area).toBe("");
  });

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
      pricingHint: "₹20,000/month",
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

  it("never takes a price from the Spaces Near block", () => {
    const unpricedFixture = `## Overview of Cubic Business Centre

Affordable office spaces in Koramangala.

## Pricing Plans

Coworking SpacePrivate Office

### Daily

Price on request

price / person

### Monthly

Price on request

price / person

### Spaces Near 83/A, 16th

![icon](https://d2w68ocb6l47bj.cloudfront.net/v20251122/_redesign/img/marker.png)
139, First Cross Road, V Block, 5th Block, Koramangala

From ₹450 /pp/day

##### Coworking Space: Abode Nestor
`;

    const listing = parseCoworkerDetail(
      unpricedFixture,
      "https://www.coworker.com/india/bengaluru/cubic-business-centre",
    );

    expect(listing?.pricingHint).toBeNull();
  });

  it("returns null for non-detail URLs", () => {
    expect(parseCoworkerDetail(detailFixture, COWORKER_LIST_BASE)).toBeNull();
  });
});

describe("coworkerAdapter", () => {
  beforeEach(() => {
    vi.mocked(firecrawlScrape).mockReset();
  });

  it("discovers canonical source ids without scraping detail pages", async () => {
    vi.mocked(firecrawlScrape).mockImplementation(async (url: string) => {
      if (url === COWORKER_LIST_BASE) {
        return { markdown: listFixture, links: [] };
      }
      if (url === `${COWORKER_LIST_BASE}?page=2`) {
        return { markdown: "no new listings", links: [] };
      }
      return { markdown: "", links: [] };
    });

    const discovered = await coworkerAdapter.discover();

    expect(coworkerAdapter.source).toBe("coworker");
    expect(firecrawlScrape).toHaveBeenCalledWith(COWORKER_LIST_BASE, { includeLinks: true });
    expect(firecrawlScrape).toHaveBeenCalledWith(`${COWORKER_LIST_BASE}?page=2`, {
      includeLinks: true,
    });
    expect(discovered).toEqual([
      {
        sourceId: "cowrks-ecoworld",
        url: "https://www.coworker.com/india/bengaluru/cowrks-ecoworld",
      },
      {
        sourceId: "regus-bangalore-world-trade-centre",
        url: "https://www.coworker.com/india/bengaluru/regus-bangalore-world-trade-centre",
      },
    ]);
  });

  it("fetches and parses one detail page without requesting links", async () => {
    vi.mocked(firecrawlScrape).mockResolvedValue({ markdown: detailFixture, links: [] });

    const parsed = await coworkerAdapter.fetchDetail(
      "https://www.coworker.com/india/bengaluru/cowrks-ecoworld",
    );

    expect(parsed?.sourceId).toBe("cowrks-ecoworld");
    expect(firecrawlScrape).toHaveBeenCalledWith(
      "https://www.coworker.com/india/bengaluru/cowrks-ecoworld",
    );
  });
});
