import { describe, expect, it } from "vitest";
import {
  buildDescriptionEmbeddingText,
  buildListingEmbeddingText,
  buildStructuredEmbeddingText,
} from "./embedding-text";

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

describe("buildStructuredEmbeddingText", () => {
  it("joins only categorical fields", () => {
    const text = buildStructuredEmbeddingText({
      title: "WeWork Koramangala",
      area: "Koramangala",
      city: "Bengaluru",
      propertyType: "Private cabin",
      pricingHint: "From ₹12,000",
      amenities: ["WiFi", "AC"],
    });
    expect(text).toBe(
      "WeWork Koramangala · Koramangala · Bengaluru · Private cabin · From ₹12,000 · WiFi, AC",
    );
  });

  it("skips empty amenities and null fields", () => {
    const text = buildStructuredEmbeddingText({
      title: "X",
      area: "",
      city: "",
      propertyType: null,
      pricingHint: null,
      amenities: [],
    });
    expect(text).toBe("X");
  });
});

describe("buildDescriptionEmbeddingText", () => {
  it("joins short teaser and description", () => {
    const text = buildDescriptionEmbeddingText({
      shortTeaser: "Near metro",
      description: "Quiet floors with 24/7 access",
    });
    expect(text).toBe("Near metro · Quiet floors with 24/7 access");
  });

  it("returns empty string when both fields are empty", () => {
    expect(buildDescriptionEmbeddingText({ shortTeaser: "", description: "" })).toBe("");
  });
});
