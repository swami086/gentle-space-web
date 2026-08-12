import { describe, it, expect } from "vitest";
import { listingSlugFromUrl } from "./listing-url";

describe("listingSlugFromUrl", () => {
  it("extracts the slug from a canonical listing URL", () => {
    expect(listingSlugFromUrl("https://www.gentlespacesolutions.com/spaces/wework-hsr-layout")).toBe(
      "wework-hsr-layout",
    );
  });

  it("ignores a query string and a fragment", () => {
    expect(
      listingSlugFromUrl("https://www.gentlespacesolutions.com/spaces/awfis-koramangala?utm_source=g#pricing"),
    ).toBe("awfis-koramangala");
  });

  it("ignores a trailing slash", () => {
    expect(listingSlugFromUrl("https://www.gentlespacesolutions.com/spaces/indiqube-orr/")).toBe(
      "indiqube-orr",
    );
  });

  it("returns null for the /spaces index — the campaign default final_url", () => {
    expect(listingSlugFromUrl("https://www.gentlespacesolutions.com/spaces")).toBeNull();
    expect(listingSlugFromUrl("https://www.gentlespacesolutions.com/spaces/")).toBeNull();
  });

  it("returns null for a path that is not a listing", () => {
    expect(listingSlugFromUrl("https://www.gentlespacesolutions.com/about")).toBeNull();
    expect(listingSlugFromUrl("https://www.gentlespacesolutions.com/")).toBeNull();
  });

  it("returns null for a nested path below a listing rather than guessing the parent", () => {
    expect(listingSlugFromUrl("https://www.gentlespacesolutions.com/spaces/hsr/gallery")).toBeNull();
  });

  it("returns null for junk instead of throwing", () => {
    expect(listingSlugFromUrl("not a url")).toBeNull();
    expect(listingSlugFromUrl("")).toBeNull();
  });
});
