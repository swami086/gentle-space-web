import { describe, expect, it } from "vitest";
import type { RawListing } from "./sources/types";
import { contentHash, embedHash, hashEmbeddingText } from "./content-hash";

const row = (over: Partial<RawListing> = {}): RawListing => ({
  source: "coworker",
  sourceId: "space-1",
  title: "Space One",
  description: "Quiet workspace",
  shortTeaser: "Quiet workspace",
  address: "1 Main Road",
  area: "Bellandur",
  city: "Bengaluru",
  lat: 12.93,
  lng: 77.69,
  amenities: ["WiFi", "Coffee"],
  images: ["https://img.example/one.jpg"],
  pricingHint: "₹10,000/month",
  propertyType: "Coworking",
  sourceUrl: "https://example.com/space-1",
  ...over,
});

describe("listing content hashes", () => {
  it("hashEmbeddingText matches embedHash for the same embedding fields", () => {
    const r = row();
    expect(
      hashEmbeddingText({
        title: r.title,
        area: r.area,
        city: r.city,
        propertyType: r.propertyType,
        pricingHint: r.pricingHint,
        shortTeaser: r.shortTeaser,
        description: r.description,
        amenities: ["Coffee", "WiFi"],
      }),
    ).toBe(embedHash(r));
  });

  it("hashEmbeddingText is stable under amenity reorder", () => {
    const fields = {
      title: "A",
      area: "B",
      city: "Bengaluru",
      propertyType: null,
      pricingHint: null,
      shortTeaser: "",
      description: "d",
      amenities: ["WiFi", "Coffee"],
    };
    expect(hashEmbeddingText(fields)).toBe(
      hashEmbeddingText({ ...fields, amenities: ["Coffee", "WiFi"] }),
    );
  });

  it("is deterministic and ignores amenity ordering", () => {
    expect(contentHash(row())).toBe(contentHash(row({ amenities: ["Coffee", "WiFi"] })));
    expect(embedHash(row())).toBe(embedHash(row({ amenities: ["Coffee", "WiFi"] })));
  });

  it("changes both hashes when embedding text changes", () => {
    expect(contentHash(row({ pricingHint: "₹12,000/month" }))).not.toBe(contentHash(row()));
    expect(embedHash(row({ pricingHint: "₹12,000/month" }))).not.toBe(embedHash(row()));
  });

  it("does not re-embed an image-only change", () => {
    const changed = row({ images: ["https://img.example/two.jpg"] });
    expect(contentHash(changed)).not.toBe(contentHash(row()));
    expect(embedHash(changed)).toBe(embedHash(row()));
  });
});
