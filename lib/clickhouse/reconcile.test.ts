import { describe, it, expect } from "vitest";
import { compareCounts, evaluateReport } from "./reconcile";

describe("compareCounts", () => {
  it("returns nothing when every tenant-day agrees", () => {
    const rows = [
      { org_id: "a", occurred_on: "2026-08-01", rows: 3 },
      { org_id: "b", occurred_on: "2026-08-01", rows: 5 },
    ];
    expect(compareCounts(rows, rows)).toEqual([]);
  });

  it("localises a shortfall to the tenant and the day", () => {
    expect(
      compareCounts(
        [{ org_id: "a", occurred_on: "2026-08-01", rows: 3 }],
        [{ org_id: "a", occurred_on: "2026-08-01", rows: 2 }],
      ),
    ).toEqual([{ orgId: "a", occurredOn: "2026-08-01", sourceRows: 3, mirrorRows: 2 }]);
  });

  it("reports a tenant-day present only in the mirror as a divergence, not as absence", () => {
    expect(compareCounts([], [{ org_id: "b", occurred_on: "2026-08-02", rows: 1 }])).toEqual([
      { orgId: "b", occurredOn: "2026-08-02", sourceRows: 0, mirrorRows: 1 },
    ]);
  });
});

describe("evaluateReport", () => {
  const clean = { cutoff: "2026-08-12 09:00:00.000", lagSeconds: 30, divergences: [], sampleMismatches: [] };

  it("passes a clean report inside the lag threshold", () => {
    expect(evaluateReport(clean, 900)).toEqual({ ok: true, alert: null });
  });

  it("alerts on lag above the threshold even with no divergence", () => {
    const result = evaluateReport({ ...clean, lagSeconds: 1200 }, 900);
    expect(result.ok).toBe(false);
    expect(result.alert).toContain("cdc lag 1200s");
  });

  it("alerts on divergence even when lag is healthy", () => {
    const result = evaluateReport(
      { ...clean, divergences: [{ orgId: "a", occurredOn: "2026-08-01", sourceRows: 3, mirrorRows: 2 }] },
      900,
    );
    expect(result.ok).toBe(false);
    expect(result.alert).toContain("a/2026-08-01 source=3 mirror=2");
  });

  it("alerts on a sampled field mismatch when counts happen to agree", () => {
    const result = evaluateReport({ ...clean, sampleMismatches: ["enquiry 7 reply_state waiting != called"] }, 900);
    expect(result.ok).toBe(false);
    expect(result.alert).toContain("reply_state");
  });
});
