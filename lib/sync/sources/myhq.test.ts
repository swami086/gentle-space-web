import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MYHQ_SEED_URL,
  extractMyhqDetailUrls,
  isMyhqDetailUrl,
  myhqAdapter,
  parseMyhqDetail,
} from "./myhq";

vi.mock("@/lib/firecrawl/client", () => ({
  firecrawlMap: vi.fn(),
  firecrawlScrape: vi.fn(),
}));

import { firecrawlMap, firecrawlScrape } from "@/lib/firecrawl/client";

const weworkFixture = `## WeWork

coworking | Koramangala, Bangalore

Home› Coworking Space › Bangalore› Koramangala› WeWork

# WeWork - Prestige Atlanta

Koramangala , Bangalore

₹15,499/ desk / monthQuoted price (negotiable)

4.5

966 reviews

![WeWork Prestige Atlanta](https://myhq.in/images/wework-prestige-atlanta.jpg)

WeWork Prestige Atlanta is a four-floor coworking and private office centre on 80 Feet Main Road in Koramangala, Bangalore, with easy MG Road metro access. Workspace options include flexible coworking memberships, private offices, dedicated desks and fully equipped conference rooms.

Read more

## Center Details

### Address

Prestige Atlanta, 80 Feet Rd, Koramangala 1A Block, Koramangala, Bengaluru, Karnataka

### Common amenities

Paid Amenity

2 wheeler parking

4 wheeler parking

Wifi

Printer

Tea

Coffee
`;

describe("isMyhqDetailUrl", () => {
  it("accepts dedicated coworking detail slugs", () => {
    expect(
      isMyhqDetailUrl("https://myhq.in/dedicated/coworking-space/wework-prestige-atlanta"),
    ).toBe(true);
    expect(
      isMyhqDetailUrl("https://myhq.in/dedicated/coworking-space/incubex-koramangala/"),
    ).toBe(true);
  });

  it("rejects city and locality index pages", () => {
    expect(isMyhqDetailUrl(MYHQ_SEED_URL)).toBe(false);
    expect(
      isMyhqDetailUrl("https://myhq.in/bangalore/dedicated/coworking-space-in-bangalore"),
    ).toBe(false);
    expect(
      isMyhqDetailUrl("https://myhq.in/bangalore/dedicated/coworking-space-in-koramangala"),
    ).toBe(false);
  });

  it("rejects flexi day-pass product pages", () => {
    expect(
      isMyhqDetailUrl("https://myhq.in/flexi/coworking-space/wework-prestige-atlanta"),
    ).toBe(false);
  });
});

describe("extractMyhqDetailUrls", () => {
  it("dedupes and canonicalizes detail links", () => {
    const urls = extractMyhqDetailUrls([
      "https://myhq.in/dedicated/coworking-space/wework-prestige-atlanta",
      "https://myhq.in/dedicated/coworking-space/wework-prestige-atlanta/",
      "https://myhq.in/bangalore/dedicated/coworking-space-in-bangalore",
      "https://myhq.in/dedicated/coworking-space/incubex-koramangala",
    ]);
    expect(urls).toEqual([
      "https://myhq.in/dedicated/coworking-space/wework-prestige-atlanta",
      "https://myhq.in/dedicated/coworking-space/incubex-koramangala",
    ]);
  });
});

describe("parseMyhqDetail", () => {
  it("parses markdown fixture into RawListing", () => {
    const listing = parseMyhqDetail(
      weworkFixture,
      "https://myhq.in/dedicated/coworking-space/wework-prestige-atlanta",
    );

    expect(listing).toMatchObject({
      source: "myhq",
      sourceId: "wework-prestige-atlanta",
      title: "WeWork - Prestige Atlanta",
      area: "Koramangala",
      city: "Bengaluru",
      address: "Prestige Atlanta, 80 Feet Rd, Koramangala 1A Block, Koramangala, Bengaluru, Karnataka",
      pricingHint: "₹15,499/ desk / monthQuoted price (negotiable)",
      propertyType: "Coworking",
      sourceUrl: "https://myhq.in/dedicated/coworking-space/wework-prestige-atlanta",
    });
    expect(listing?.description).toContain("four-floor coworking");
    expect(listing?.shortTeaser).toContain("four-floor coworking");
    expect(listing?.images).toContain("https://myhq.in/images/wework-prestige-atlanta.jpg");
    expect(listing?.amenities).toEqual(
      expect.arrayContaining(["2 wheeler parking", "Wifi", "Printer"]),
    );
    expect(listing?.lat).toBeNull();
    expect(listing?.lng).toBeNull();
  });

  it("returns null for non-detail URLs", () => {
    expect(parseMyhqDetail(weworkFixture, MYHQ_SEED_URL)).toBeNull();
  });
});

describe("myhqAdapter", () => {
  beforeEach(() => {
    vi.mocked(firecrawlMap).mockReset();
    vi.mocked(firecrawlScrape).mockReset();
  });

  it("discovers canonical source ids without scraping detail pages", async () => {
    vi.mocked(firecrawlMap).mockResolvedValue([
      "https://myhq.in/dedicated/coworking-space/wework-prestige-atlanta",
      "https://myhq.in/bangalore/dedicated/coworking-space-in-bangalore",
    ]);
    vi.mocked(firecrawlScrape).mockImplementation(async (url: string) => {
      if (url === MYHQ_SEED_URL) {
        return {
          markdown:
            "[Incubex](https://myhq.in/dedicated/coworking-space/incubex-koramangala)",
          links: [],
        };
      }
      return { markdown: "", links: [] };
    });

    const discovered = await myhqAdapter.discover();

    expect(myhqAdapter.source).toBe("myhq");
    expect(firecrawlMap).toHaveBeenCalledWith(MYHQ_SEED_URL);
    expect(firecrawlScrape).toHaveBeenCalledWith(MYHQ_SEED_URL, { includeLinks: true });
    expect(discovered).toEqual([
      {
        sourceId: "wework-prestige-atlanta",
        url: "https://myhq.in/dedicated/coworking-space/wework-prestige-atlanta",
      },
      {
        sourceId: "incubex-koramangala",
        url: "https://myhq.in/dedicated/coworking-space/incubex-koramangala",
      },
    ]);
  });

  it("fetches and parses one detail page without requesting links", async () => {
    vi.mocked(firecrawlScrape).mockResolvedValue({ markdown: weworkFixture, links: [] });

    const parsed = await myhqAdapter.fetchDetail(
      "https://myhq.in/dedicated/coworking-space/wework-prestige-atlanta",
    );

    expect(parsed?.sourceId).toBe("wework-prestige-atlanta");
    expect(firecrawlScrape).toHaveBeenCalledWith(
      "https://myhq.in/dedicated/coworking-space/wework-prestige-atlanta",
    );
  });
});
