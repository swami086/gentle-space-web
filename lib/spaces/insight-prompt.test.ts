import { describe, expect, it } from "vitest";
import type { InsightFacts } from "./insight-types";
import { buildInsightUserText, emptyInsightContent, parseInsightJson } from "./insight-prompt";

const facts: InsightFacts = {
  title: "CoWrks Ecoworld",
  area: "Bellandur",
  city: "Bengaluru",
  propertyType: "Coworking",
  pricingHint: "₹9000",
  amenities: ["WiFi", "Parking"],
  description: "A large format shared office space.",
  query: "coworking near metro with coffee",
  nearby: [
    {
      category: "cafe",
      label: "Cafes",
      places: [{ name: "Third Wave", distanceLabel: "~300 m" }],
    },
  ],
};

describe("buildInsightUserText", () => {
  it("includes the query, listing facts and nearby places", () => {
    const text = buildInsightUserText(facts);

    expect(text).toContain("Search: coworking near metro with coffee");
    expect(text).toContain("Space: CoWrks Ecoworld");
    expect(text).toContain("Area: Bellandur, Bengaluru");
    expect(text).toContain("Amenities: WiFi, Parking");
    expect(text).toContain("Nearby Cafes: Third Wave (~300 m)");
  });
});

describe("parseInsightJson", () => {
  it("parses summary and highlights", () => {
    const parsed = parseInsightJson(
      JSON.stringify({
        summary: "Matches your Bellandur ask.",
        highlights: [{ label: "Cafes", detail: "Third Wave ~300 m" }],
      }),
    );

    expect(parsed).toEqual({
      summary: "Matches your Bellandur ask.",
      highlights: [{ label: "Cafes", detail: "Third Wave ~300 m" }],
    });
  });

  it("caps highlights at 4 and drops malformed entries", () => {
    const parsed = parseInsightJson(
      JSON.stringify({
        summary: "ok",
        highlights: [
          { label: "a", detail: "1" },
          { label: "", detail: "2" },
          { label: "c", detail: "3" },
          { label: "d", detail: "4" },
          { label: "e", detail: "5" },
          { label: "f", detail: "6" },
        ],
      }),
    );

    expect(parsed.highlights).toHaveLength(4);
    expect(parsed.highlights.map((h) => h.label)).toEqual(["a", "c", "d", "e"]);
  });

  it("returns empty content for invalid JSON", () => {
    expect(parseInsightJson("not json")).toEqual(emptyInsightContent());
  });
});
