import { describe, expect, it } from "vitest";
import { buildListingEmbeddingText } from "./embedding-text";

describe("buildListingEmbeddingText", () => {
  it("joins non-empty fields", () => {
    const text = buildListingEmbeddingText({
      title: "WeWork Koramangala",
      area: "Koramangala",
      city: "Bengaluru",
      propertyType: "Private cabin",
      pricingHint: "From ₹12,000",
      shortTeaser: "Near metro",
      description: "Quiet floors",
      amenities: ["WiFi", "AC"],
    });
    expect(text).toContain("WeWork Koramangala");
    expect(text).toContain("WiFi, AC");
    expect(text).not.toMatch(/\n{3,}/);
  });

  it("skips empty amenities", () => {
    const text = buildListingEmbeddingText({
      title: "X",
      area: "",
      city: "",
      propertyType: null,
      pricingHint: null,
      shortTeaser: "",
      description: "",
      amenities: [],
    });
    expect(text).toBe("X");
  });
});
