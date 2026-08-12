// ads-agent/mcp/context-server/read-spaces.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const txQuery = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({
  withAgentTenantTx: async (_orgId: string, fn: (tx: { query: typeof txQuery }) => Promise<unknown>) =>
    fn({ query: txQuery }),
}));

import { getSpace, searchSpaces } from "./read-spaces";

const CLAIMS = {
  orgId: "11111111-1111-1111-1111-111111111111",
  taskId: "task-1",
  profile: "leads",
  toolAllowlist: ["search_spaces", "get_space"],
};
const SPACE = "44444444-4444-4444-4444-444444444444";

const ROW = {
  id: SPACE,
  name: "Whitefield Tower 3",
  corridor_id: null,
  desks: 40,
  price_per_desk: "9500",
  amenities: ["parking"],
  updated_at: new Date("2026-08-11T10:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  txQuery.mockResolvedValue({ rows: [ROW], rowCount: 1 });
});

describe("searchSpaces", () => {
  it("reads the tenant-scoped view and binds the query as a parameter", async () => {
    await searchSpaces(CLAIMS, { query: "whitefield 40 desks" });
    const [sql, params] = txQuery.mock.calls[0];
    expect(String(sql)).toContain("context.v_agent_spaces");
    expect(String(sql)).not.toContain("listings.listings");
    expect(String(sql)).not.toContain("whitefield");
    expect(params).toContain("whitefield 40 desks");
  });

  it("binds every filter rather than concatenating a predicate", async () => {
    await searchSpaces(CLAIMS, {
      query: "office",
      filters: { corridor: "Whitefield", minDesks: 20, maxDesks: 60, maxPricePerDesk: 12000 },
    });
    const [, params] = txQuery.mock.calls[0];
    expect(params).toEqual(expect.arrayContaining(["Whitefield", 20, 60, 12000]));
  });

  it("returns numbers not numeric strings", async () => {
    const [space] = await searchSpaces(CLAIMS, { query: "office" });
    expect(space.pricePerDesk).toBe(9500);
    expect(space.desks).toBe(40);
    expect(space.updatedAt).toBe("2026-08-11T10:00:00.000Z");
  });

  it("rejects an empty query rather than returning the whole catalogue", async () => {
    await expect(searchSpaces(CLAIMS, { query: "   " })).rejects.toThrow("invalid_query");
    expect(txQuery).not.toHaveBeenCalled();
  });
});

describe("getSpace", () => {
  it("returns null for another tenant's id", async () => {
    txQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await getSpace(CLAIMS, SPACE)).toBeNull();
  });

  it("rejects a malformed id before querying", async () => {
    await expect(getSpace(CLAIMS, "nope")).rejects.toThrow("invalid_space_id");
    expect(txQuery).not.toHaveBeenCalled();
  });
});
