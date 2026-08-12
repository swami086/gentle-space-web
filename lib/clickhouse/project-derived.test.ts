import { describe, it, expect, vi, beforeEach } from "vitest";

const chQuery = vi.fn();
vi.mock("./client", () => ({ chQuery: (...a: unknown[]) => chQuery(...a) }));

const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
vi.mock("../db/tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: clientQuery }),
}));

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const scope = { kind: "org", orgId: ORG } as const;

beforeEach(() => {
  chQuery.mockReset();
  clientQuery.mockReset().mockResolvedValue({ rows: [] });
});

describe("rebuildPortalSessionSpaces", () => {
  it("truncates the tenant's rows before inserting, because the table is rebuildable", async () => {
    chQuery.mockResolvedValue([
      { session_id: "sess-1", listing_ref: "l-1", view_count: "2", dwell_seconds: "40", last_viewed_at: "2026-08-12 09:00:00" },
    ]);
    const { rebuildPortalSessionSpaces } = await import("./project-derived");
    const written = await rebuildPortalSessionSpaces(scope);

    const statements = clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((s) => s.includes("DELETE FROM derived.portal_session_spaces"))).toBe(true);
    const deleteIndex = statements.findIndex((s) => s.includes("DELETE FROM"));
    const insertIndex = statements.findIndex((s) => s.includes("INSERT INTO derived.portal_session_spaces"));
    expect(deleteIndex).toBeLessThan(insertIndex);
    expect(written).toBe(1);
  });

  it("reads only listing_view events for the requested tenant", async () => {
    chQuery.mockResolvedValue([]);
    const { rebuildPortalSessionSpaces } = await import("./project-derived");
    await rebuildPortalSessionSpaces(scope);
    const [sql, options] = chQuery.mock.calls[0] as [string, { params: Record<string, string> }];
    expect(sql).toContain("raw.portal_events");
    expect(sql).toContain("listing_view");
    expect(options.params.org).toBe(ORG);
  });

  it("writes nothing when the tenant has no clickstream, and still truncates", async () => {
    chQuery.mockResolvedValue([]);
    const { rebuildPortalSessionSpaces } = await import("./project-derived");
    expect(await rebuildPortalSessionSpaces(scope)).toBe(0);
    expect(clientQuery.mock.calls.map(([sql]) => String(sql)).some((s) => s.includes("DELETE FROM"))).toBe(true);
  });

  it("refuses platform scope, because a projection has to name its tenant", async () => {
    const { rebuildPortalSessionSpaces } = await import("./project-derived");
    await expect(rebuildPortalSessionSpaces({ kind: "platform", orgId: ORG })).rejects.toThrow("org scope");
  });
});
