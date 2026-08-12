import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));
vi.mock("./scope-sql", () => ({
  scopeClause: (scope: { kind: string; orgId: string }, column = "org_id") =>
    scope.kind === "platform"
      ? { sql: "TRUE", params: [] }
      : { sql: `${column} = $1`, params: [scope.orgId] },
}));

const ORG = "66666666-6666-6666-6666-666666666666";
const SCOPE = { kind: "org" as const, orgId: ORG };

beforeEach(() => query.mockReset());

describe("listCorridors", () => {
  it("reads the shared vocabulary and maps it to camelCase", async () => {
    query.mockResolvedValue({
      rows: [
        { id: "c1", slug: "hsr-layout", display_name: "HSR Layout", city: "Bangalore", parent_id: null },
      ],
    });
    const { listCorridors } = await import("./corridors");
    expect(await listCorridors(SCOPE)).toEqual([
      { id: "c1", slug: "hsr-layout", displayName: "HSR Layout", city: "Bangalore", parentId: null },
    ]);
    expect(query.mock.calls[0][0]).toContain("FROM public.corridors");
  });
});

describe("corridorListingIds", () => {
  it("scopes the listing side and filters by corridor", async () => {
    query.mockResolvedValue({ rows: [{ listing_id: "l1" }, { listing_id: "l2" }] });
    const { corridorListingIds } = await import("./corridors");
    expect(await corridorListingIds(SCOPE, "c1")).toEqual(["l1", "l2"]);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("FROM listings.listing_corridors");
    expect(sql).toContain("l.org_id = $1");
    expect(params).toEqual([ORG, "c1"]);
  });
});

describe("resolveEnquiryListings", () => {
  it("resolves listing_id and corridor_id from listing_url within scope", async () => {
    query.mockResolvedValue({ rowCount: 3 });
    const { resolveEnquiryListings } = await import("./corridors");
    expect(await resolveEnquiryListings(SCOPE, 500)).toBe(3);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("UPDATE adsagent.enquiries");
    expect(sql).toContain("org_id = $1");
    expect(sql).toContain("'%/spaces/%'");
    expect(params).toEqual([ORG, 500]);
  });

  it("rejects a non-positive batch size", async () => {
    const { resolveEnquiryListings } = await import("./corridors");
    await expect(resolveEnquiryListings(SCOPE, 0)).rejects.toThrow(/limit/);
  });
});

describe("countUnresolvedEnquiries", () => {
  it("counts enquiries with no listing so the gap is a figure, not a silence", async () => {
    query.mockResolvedValue({ rows: [{ count: "12" }] });
    const { countUnresolvedEnquiries } = await import("./corridors");
    expect(await countUnresolvedEnquiries(SCOPE)).toBe(12);
    expect(query.mock.calls[0][0]).toContain("listing_id IS NULL");
  });
});
