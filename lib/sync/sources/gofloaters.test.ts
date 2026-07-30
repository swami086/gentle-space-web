import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOFLOATERS_INDEX_URL,
  extractGoFloatersDetailUrls,
  gofloatersAdapter,
  isGoFloatersDetailUrl,
  isGoFloatersLocalityUrl,
  parseGoFloatersDetail,
} from "./gofloaters";

vi.mock("@/lib/firecrawl/client", () => ({
  firecrawlMap: vi.fn(),
  firecrawlScrape: vi.fn(),
}));

import { firecrawlMap, firecrawlScrape } from "@/lib/firecrawl/client";

const weworkFixture = `
![Open Desks](https://cdn.app.gofloaters.com/images%2FOpen%20Desk%20%7C%20Koramangala_1647369004113?alt=media&token=f3cb38ff-7228-445e-945c-906d299184a3)

[WeWork Prestige Atlanta](https://gofloaters.com/bengaluru/wework-prestige-atlanta/)• GoOffice 2817

4.3 \\|978Reviews

# Open Desks in Koramangala,Bengaluru

Located in Bengaluru's vibrant start-up hub, our Koramangala office space could not be better situated for young entrepreneurs.

#### What this place offers

Hi Speed WiFi
Power Backup
Meeting Rooms

Show all 10 amenities

What is the nearest landmark to GoOffice 2817 - WeWork Prestige Atlanta?

GoOffice 2817 - WeWork Prestige Atlanta is in Koramangala. Landmark for this space is : Opposite to Wipro Park

#### WeWork Prestige AtlantaKoramangala Overview

GoOffice 2817 : Located in Bengaluru's vibrant start-up hub, our Koramangala office space could not be better situated for young entrepreneurs. You can book this space at Rs 800 / day / person.

₹750/day
`;

describe("isGoFloatersDetailUrl", () => {
  it("accepts office-space and coworking-space detail URLs", () => {
    expect(
      isGoFloatersDetailUrl(
        "https://gofloaters.com/coworking-space/gooffice-2817-open-desks-koramangala-bengaluru/",
      ),
    ).toBe(true);
    expect(
      isGoFloatersDetailUrl(
        "https://gofloaters.com/office-space/gooffice-2454-open-desks-koramangala-bengaluru/",
      ),
    ).toBe(true);
  });

  it("rejects index and locality pages", () => {
    expect(isGoFloatersDetailUrl(GOFLOATERS_INDEX_URL)).toBe(false);
    expect(
      isGoFloatersDetailUrl("https://gofloaters.com/office-spaces/bengaluru/koramangala/"),
    ).toBe(false);
  });
});

describe("isGoFloatersLocalityUrl", () => {
  it("accepts bengaluru locality pages", () => {
    expect(
      isGoFloatersLocalityUrl("https://gofloaters.com/office-spaces/bengaluru/koramangala/"),
    ).toBe(true);
  });

  it("rejects city index", () => {
    expect(isGoFloatersLocalityUrl(GOFLOATERS_INDEX_URL)).toBe(false);
  });
});

describe("extractGoFloatersDetailUrls", () => {
  it("dedupes and normalizes detail links", () => {
    const urls = extractGoFloatersDetailUrls([
      "https://gofloaters.com/coworking-space/gooffice-2817-open-desks-koramangala-bengaluru",
      "https://gofloaters.com/coworking-space/gooffice-2817-open-desks-koramangala-bengaluru/",
      GOFLOATERS_INDEX_URL,
      "https://gofloaters.com/office-space/gooffice-2454-open-desks-koramangala-bengaluru/",
    ]);
    expect(urls).toEqual([
      "https://gofloaters.com/coworking-space/gooffice-2817-open-desks-koramangala-bengaluru/",
      "https://gofloaters.com/office-space/gooffice-2454-open-desks-koramangala-bengaluru/",
    ]);
  });
});

describe("parseGoFloatersDetail", () => {
  it("parses markdown fixture into RawListing", () => {
    const listing = parseGoFloatersDetail(
      weworkFixture,
      "https://gofloaters.com/coworking-space/gooffice-2817-open-desks-koramangala-bengaluru/",
    );

    expect(listing).toMatchObject({
      source: "gofloaters",
      sourceId: "gooffice-2817",
      title: "WeWork Prestige Atlanta - Open Desks",
      area: "Koramangala",
      city: "Bengaluru",
      address: "Opposite to Wipro Park",
      pricingHint: "₹750/day",
      propertyType: "Open Desks",
      sourceUrl: "https://gofloaters.com/coworking-space/gooffice-2817-open-desks-koramangala-bengaluru/",
    });
    expect(listing?.description).toContain("vibrant start-up hub");
    expect(listing?.shortTeaser).toContain("vibrant start-up hub");
    expect(listing?.images[0]).toContain("cdn.app.gofloaters.com");
    expect(listing?.amenities).toEqual(
      expect.arrayContaining(["Hi Speed WiFi", "Meeting Rooms"]),
    );
  });

  it("returns null for non-detail URLs", () => {
    expect(parseGoFloatersDetail(weworkFixture, GOFLOATERS_INDEX_URL)).toBeNull();
  });
});

describe("gofloatersAdapter.fetchAll", () => {
  beforeEach(() => {
    vi.mocked(firecrawlMap).mockReset();
    vi.mocked(firecrawlScrape).mockReset();
  });

  it("discovers locality pages then scrapes detail URLs", async () => {
    vi.mocked(firecrawlMap).mockResolvedValue([
      "https://gofloaters.com/office-spaces/bengaluru/koramangala/",
      "https://gofloaters.com/office-spaces/bengaluru/hsr-layout/",
    ]);
    vi.mocked(firecrawlScrape).mockImplementation(async (url: string) => {
      if (url === GOFLOATERS_INDEX_URL) {
        return { markdown: "", links: [] };
      }
      if (url === "https://gofloaters.com/office-spaces/bengaluru/koramangala/") {
        return {
          markdown: "",
          links: [
            "https://gofloaters.com/coworking-space/gooffice-2817-open-desks-koramangala-bengaluru/",
          ],
        };
      }
      if (url === "https://gofloaters.com/office-spaces/bengaluru/hsr-layout/") {
        return {
          markdown: "[Awfis](https://gofloaters.com/office-space/gooffice-2454-open-desks-hsr-layout-bengaluru/)",
          links: [],
        };
      }
      if (url.includes("gooffice-2817")) {
        return { markdown: weworkFixture, links: [] };
      }
      if (url.includes("gooffice-2454")) {
        return {
          markdown: `# Dedicated Desks in HSR Layout,Bengaluru\n\n[Awfis HSR](https://gofloaters.com/)• GoOffice 2454\n\nHSR workspace.`,
          links: [],
        };
      }
      return { markdown: "", links: [] };
    });

    const listings = await gofloatersAdapter.fetchAll();

    expect(gofloatersAdapter.source).toBe("gofloaters");
    expect(firecrawlMap).toHaveBeenCalledWith(GOFLOATERS_INDEX_URL);
    expect(listings).toHaveLength(2);
    expect(listings.map((l) => l.sourceId).sort()).toEqual(["gooffice-2454", "gooffice-2817"]);
  });

  it("throws when no detail URLs are discovered", async () => {
    vi.mocked(firecrawlMap).mockResolvedValue([
      "https://gofloaters.com/office-spaces/bengaluru/koramangala/",
    ]);
    vi.mocked(firecrawlScrape).mockResolvedValue({ markdown: "no listings", links: [] });

    await expect(gofloatersAdapter.fetchAll()).rejects.toThrow(/no detail URLs/);
  });
});
