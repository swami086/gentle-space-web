import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Scope } from "../db/scope-sql";

const chQuery = vi.fn();
vi.mock("./clickhouse", () => ({ chQuery }));

const ORG = "11111111-1111-1111-1111-111111111111";
const SNAP = "22222222-2222-2222-2222-222222222222";
const SPACE = "33333333-3333-3333-3333-333333333333";
const CORRIDOR = "44444444-4444-4444-4444-444444444444";
const scope = { kind: "org", orgId: ORG } as Scope;

beforeEach(() => chQuery.mockReset());

describe("convertingCorridors", () => {
  it("traverses TARGETS then GENERATED then RESULTED_IN", async () => {
    chQuery.mockResolvedValue([]);
    const { convertingCorridors } = await import("./traverse");
    await convertingCorridors(scope, SNAP);
    const sql = String(chQuery.mock.calls[0][0]);
    expect(sql).toContain("'TARGETS'");
    expect(sql).toContain("'GENERATED'");
    expect(sql).toContain("'RESULTED_IN'");
  });

  it("bounds the tenant twice: as a predicate and as the row-policy setting", async () => {
    chQuery.mockResolvedValue([]);
    const { convertingCorridors } = await import("./traverse");
    await convertingCorridors(scope, SNAP);
    const [sql, opts] = chQuery.mock.calls[0];
    expect(String(sql)).toContain("org_id = toUUID({org:String})");
    expect(opts).toMatchObject({
      orgId: ORG,
      params: expect.objectContaining({ org: ORG, snap: SNAP }),
    });
  });

  it("maps rows and returns a numeric rate", async () => {
    chQuery.mockResolvedValue([
      {
        corridorId: CORRIDOR,
        corridorLabel: "HSR Layout",
        enquiries: "10",
        converted: "3",
        conversionRate: 0.3,
      },
    ]);
    const { convertingCorridors } = await import("./traverse");
    await expect(convertingCorridors(scope, SNAP)).resolves.toEqual([
      {
        corridorId: CORRIDOR,
        corridorLabel: "HSR Layout",
        enquiries: 10,
        converted: 3,
        conversionRate: 0.3,
      },
    ]);
  });

  it("applies a minimum enquiry count so one lucky enquiry is not a trend", async () => {
    chQuery.mockResolvedValue([]);
    const { convertingCorridors } = await import("./traverse");
    await convertingCorridors(scope, SNAP, { minEnquiries: 5 });
    expect(chQuery.mock.calls[0][1].params.minEnquiries).toBe("5");
  });
});

describe("substituteSpaces", () => {
  it("traverses SIMILAR_TO then LOCATED_IN and orders by weight", async () => {
    chQuery.mockResolvedValue([]);
    const { substituteSpaces } = await import("./traverse");
    await substituteSpaces(scope, SNAP, SPACE, 5);
    const sql = String(chQuery.mock.calls[0][0]);
    expect(sql).toContain("'SIMILAR_TO'");
    expect(sql).toContain("'LOCATED_IN'");
    expect(sql).toContain("ORDER BY weight DESC");
    expect(chQuery.mock.calls[0][1].params.limit).toBe("5");
  });
});

describe("corridorAncestors", () => {
  it("walks bounded explicit hops, never a recursive CTE", async () => {
    chQuery.mockResolvedValue([{ l1: "a", l2: "b", l3: null }]);
    const { corridorAncestors } = await import("./traverse");
    await expect(corridorAncestors(scope, SNAP, CORRIDOR)).resolves.toEqual(["a", "b"]);
    const sql = String(chQuery.mock.calls[0][0]);
    expect(sql).not.toMatch(/WITH\s+RECURSIVE/i);
    expect(sql.match(/'PART_OF'/g)).toHaveLength(3);
  });

  it("returns an empty list for a top-level corridor", async () => {
    chQuery.mockResolvedValue([{ l1: null, l2: null, l3: null }]);
    const { corridorAncestors } = await import("./traverse");
    await expect(corridorAncestors(scope, SNAP, CORRIDOR)).resolves.toEqual([]);
  });
});
