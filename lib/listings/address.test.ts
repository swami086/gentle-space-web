import { describe, expect, it } from "vitest";

import { cleanAddress, hasCityMarker, localityFromAddress } from "./address";

/**
 * Every address below is a verbatim row from the local 704-listing corpus. The scraper
 * junk prefixes are real, not invented, so passing these means the repair works on the
 * data we actually have.
 */
describe("localityFromAddress", () => {
  it("takes the component before the city, not the leading fragment", () => {
    expect(
      localityFromAddress(
        "28/1, 3rd floor, 1st Cross 15th Main Road ,E Block Behind Swathi Gardenia Hotel, Sahakar Nagar, Hebbal, Bengaluru, Karnataka 560092, India",
      ),
    ).toBe("Hebbal");
  });

  it("recovers HSR Layout from the address that produced the '2nd & 3rd Floor' bug", () => {
    expect(
      localityFromAddress(
        "2nd & 3rd Floor, #108, Opposite Corner House, 27th Main Road, Sector 2, HSR Layout, Sector 2, HSR Layout, Bengaluru, Karnataka 560102, India",
      ),
    ).toBe("HSR Layout");
  });

  it("prefers the locality over a building name earlier in the address", () => {
    expect(
      localityFromAddress("Brigade IRV Centre, Nallurhalli, Whitefield, Bengaluru, Karnataka 560066, India"),
    ).toBe("Whitefield");
  });

  it("survives an svg junk prefix on the address", () => {
    expect(
      localityFromAddress(
        "ap_marker.svg)   Metropolis Office Park Plot No: 128-P2, EPIP ZONE, Adjacent to Ginger Hotel, Industrial Area, Whitefield, Bengaluru, Karnataka 560066, India",
      ),
    ).toBe("Whitefield");
  });

  it("survives a floor fragment as the leading component", () => {
    expect(
      localityFromAddress(
        "floor, SNN Raj Pinnacle, Plot 7f Graphite India Main Road, Phase 2, Doddanakundi Industrial Area 2, EPIP Zone, Whitefield, Bengaluru, Karnataka 560048, India",
      ),
    ).toBe("Whitefield");
    expect(
      localityFromAddress(
        "d Floor, Falaknuma building, 4th Cross Road, Metro Station, behind CMH Road, Indira Nagar 1st Stage, Stage 1, Indiranagar, Bengaluru, Karnataka 560038, India",
      ),
    ).toBe("Indiranagar");
  });

  it("handles the cofynd markdown-image area where the locality is the only component", () => {
    expect(
      localityFromAddress(
        "![Location](https://cofynd.com/assets/images/icons/co-location-icon.svg) Ashok Nagar, Bangalore",
      ),
    ).toBe("Ashok Nagar");
  });

  it("strips a markdown image sitting mid-component", () => {
    expect(
      localityFromAddress(
        "Map  ![icon](https://d2w68ocb6l47bj.cloudfront.net/v20251122/_redesign/img/img_location_map_marker.svg)   Bellandur, Bengaluru, Karnataka 560103, India",
      ),
    ).toBe("Bellandur");
  });

  it("reads multi-word localities intact", () => {
    expect(
      localityFromAddress(
        "img/img_location_map_marker.svg)   No. 41, 2nd Floor, Old Airport Road, Konena Agrahara, Murgeshpalya, Jeevan Bima Nagar, Bengaluru, Karnataka 560017, India",
      ),
    ).toBe("Jeevan Bima Nagar");
    expect(
      localityFromAddress(
        "2/_redesign/img/img_location_map_marker.svg)   C-311, KSSIDC Complex, Block -1, Electronics City Phase 1, Electronic City, Bengaluru, Karnataka 560100, India",
      ),
    ).toBe("Electronic City");
  });

  it("returns empty for landmark phrases that are not addresses", () => {
    expect(localityFromAddress("Near By Trinity Metro Station")).toBe("");
    expect(localityFromAddress("Next to Forum Mall")).toBe("");
    // Mentions Bangalore, but not as an address component.
    expect(
      localityFromAddress("Near By Y-Axis \\| IELTS coaching in Bangalore \\| Study Abroad Consultants"),
    ).toBe("");
  });

  it("returns empty for missing or unusable input", () => {
    expect(localityFromAddress("")).toBe("");
    expect(localityFromAddress("   ")).toBe("");
    expect(localityFromAddress("Bengaluru, Karnataka 560001, India")).toBe("");
  });
});

describe("hasCityMarker", () => {
  it("is true only for addresses carrying a city or state token", () => {
    expect(hasCityMarker("Brigade IRV Centre, Nallurhalli, Whitefield, Bengaluru, Karnataka 560066, India")).toBe(
      true,
    );
    expect(hasCityMarker("Ashok Nagar, Bangalore")).toBe(true);
    expect(hasCityMarker("Near By Trinity Metro Station")).toBe(false);
    expect(hasCityMarker("")).toBe(false);
  });
});

describe("cleanAddress", () => {
  it("drops the scraper junk prefix but keeps the rest of the address", () => {
    expect(
      cleanAddress(
        "ap_marker.svg)   Metropolis Office Park Plot No: 128-P2, EPIP ZONE, Industrial Area, Whitefield, Bengaluru, Karnataka 560066, India",
      ),
    ).toBe(
      "Metropolis Office Park Plot No: 128-P2, EPIP ZONE, Industrial Area, Whitefield, Bengaluru, Karnataka 560066, India",
    );
  });

  it("leaves a clean address untouched", () => {
    const clean = "Brigade IRV Centre, Nallurhalli, Whitefield, Bengaluru, Karnataka 560066, India";
    expect(cleanAddress(clean)).toBe(clean);
  });

  it("collapses the repeated whitespace scrapers leave behind", () => {
    expect(cleanAddress("Map  ![icon](https://x/img_location_map_marker.svg)   Bellandur, Bengaluru")).toBe(
      "Bellandur, Bengaluru",
    );
  });
});
