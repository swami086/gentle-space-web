import { describe, it, expect, vi, beforeEach } from "vitest";

const clientQuery = vi.fn();
const release = vi.fn();
const poolQuery = vi.fn();
vi.mock("./client", () => ({
  getPool: () => ({
    query: poolQuery,
    connect: async () => ({ query: clientQuery, release }),
  }),
}));
vi.mock("./scope-sql", () => ({
  scopeClause: (scope: { kind: string; orgId: string }, column = "org_id") =>
    scope.kind === "platform"
      ? { sql: "TRUE", params: [] }
      : { sql: `${column} = $1`, params: [scope.orgId] },
}));

import { reconcile } from "../attribution/reconcile";
import { freshness } from "../attribution/freshness";

const ORG = "77777777-7777-7777-7777-777777777777";
const SCOPE = { kind: "org" as const, orgId: ORG };
const WINDOW = { startDate: "2026-08-01", endDate: "2026-08-07" };
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const FRESH = freshness(new Date("2026-08-12T10:01:00Z"), new Date("2026-08-12T10:00:00Z"));

const RESULT = reconcile({
  window: WINDOW,
  windowState: "open",
  spend: [
    { corridorId: A, spendInr: 1000 },
    { corridorId: null, spendInr: 600 },
  ],
  enquiries: [
    { corridorId: A, enquiryCount: 4 },
    { corridorId: null, enquiryCount: 2 },
  ],
});

beforeEach(() => {
  clientQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  poolQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  release.mockReset();
});

describe("writeAttribution", () => {
  it("sets the tenant transaction-scoped, inside the transaction", async () => {
    const { writeAttribution } = await import("./attribution");
    await writeAttribution(SCOPE, RESULT, FRESH);

    const statements = clientQuery.mock.calls.map((c) => String(c[0]));
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toContain("public.set_tenant");
    expect(statements.at(-1)).toBe("COMMIT");
    expect(clientQuery.mock.calls[1][1]).toEqual([ORG]);
  });

  it("writes one row per corridor plus the named unattributed bucket", async () => {
    const { writeAttribution } = await import("./attribution");
    await writeAttribution(SCOPE, RESULT, FRESH);

    const inserts = clientQuery.mock.calls.filter((c) =>
      String(c[0]).includes("derived.corridor_attribution_daily"),
    );
    expect(inserts).toHaveLength(2);
    const corridorIds = inserts.map((c) => (c[1] as unknown[])[1]);
    expect(corridorIds).toContain(A);
    expect(corridorIds).toContain(null);
  });

  it("writes the reconciliation row with the residual figures", async () => {
    const { writeAttribution } = await import("./attribution");
    await writeAttribution(SCOPE, RESULT, FRESH);

    const [sql, params] = clientQuery.mock.calls.find((c) =>
      String(c[0]).includes("derived.attribution_reconciliation"),
    )!;
    expect(sql).toContain("unattributed_spend_inr");
    expect(params).toContain(600);
    expect(params).toContain(2);
  });

  it("refuses to write a fabricated result and rolls back", async () => {
    const fabricated = {
      ...RESULT,
      corridors: [{ ...RESULT.corridors[0], spendInr: 1600, costPerEnquiryInr: 400 }],
    };
    const { writeAttribution } = await import("./attribution");
    await expect(writeAttribution(SCOPE, fabricated, FRESH)).rejects.toThrow(/not conserved/);

    const statements = clientQuery.mock.calls.map((c) => String(c[0]));
    expect(statements).not.toContain("COMMIT");
  });

  it("releases the client even when the write throws", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes("INSERT")) throw new Error("boom");
      return { rows: [], rowCount: 0 };
    });
    const { writeAttribution } = await import("./attribution");
    await expect(writeAttribution(SCOPE, RESULT, FRESH)).rejects.toThrow("boom");
    expect(release).toHaveBeenCalled();
    expect(clientQuery.mock.calls.map((c) => String(c[0]))).toContain("ROLLBACK");
  });
});

describe("readAttribution", () => {
  it("tags everything it returns as derived authority", async () => {
    poolQuery
      .mockResolvedValueOnce({
        rows: [
          {
            corridor_id: A,
            spend_inr: "1000",
            enquiry_count: 4,
            cost_per_enquiry_inr: "250",
            late_enquiry_count: 0,
            window_state: "open",
            computed_at: new Date("2026-08-12T10:01:00Z"),
            source_watermark: new Date("2026-08-12T10:00:00Z"),
            cdc_lag_seconds: 60,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            total_spend_inr: "1600",
            total_enquiry_count: 6,
            unattributed_spend_inr: "600",
            unattributed_enquiry_count: 2,
            spend_without_enquiries_inr: "0",
            enquiries_without_spend_count: 0,
            late_enquiry_count: 0,
          },
        ],
      });

    const { readAttribution } = await import("./attribution");
    const stored = await readAttribution(SCOPE, WINDOW);

    expect(stored!.authority).toBe("derived");
    expect(stored!.corridors[0].authority).toBe("derived");
    expect(stored!.corridors[0].costPerEnquiryInr).toBe(250);
    expect(stored!.residual.unattributedSpendInr).toBe(600);
    expect(stored!.freshness.cdcLagSeconds).toBe(60);
    expect(stored!.freshness.isStale).toBe(false);
  });

  it("returns null when the window has never been computed, rather than zeroes", async () => {
    poolQuery.mockResolvedValue({ rows: [] });
    const { readAttribution } = await import("./attribution");
    expect(await readAttribution(SCOPE, WINDOW)).toBeNull();
  });
});
