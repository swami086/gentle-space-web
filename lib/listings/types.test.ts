import { describe, expect, it } from "vitest";
import type { Listing, ListingSource } from "./types";

describe("ListingSource", () => {
  it("allows the four v1 sources", () => {
    const sources: ListingSource[] = ["coworker", "myhq", "cofynd", "gofloaters"];
    expect(sources).toHaveLength(4);
  });
});
