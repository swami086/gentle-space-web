import { describe, it, expect, vi, beforeEach } from "vitest";

const { writeAttribution, readAttribution } = vi.hoisted(() => ({
  writeAttribution: vi.fn(),
  readAttribution: vi.fn(),
}));
vi.mock("../db/attribution", () => ({ writeAttribution, readAttribution }));

import { assertConserved, AttributionConservationError } from "./reconcile";
import { corridorEnquirySql, corridorSpendSql, sourceWatermarkSql } from "./analytical-source";
import { rebuildAttribution } from "./rebuild";
import { allocateEqualSplit } from "./allocation";
import { assertNotSoleDerivedJustification, DerivedOnlyJustificationError } from "./quarantine";

const SCOPE = { kind: "org" as const, orgId: "12121212-1212-1212-1212-121212121212" };
const WINDOW = { startDate: "2026-08-01", endDate: "2026-08-07" };
const HSR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORR = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const NOW = new Date("2026-08-08T10:00:00Z");

function mirror() {
  return vi.fn(async (sql: string) => {
    if (sql === corridorSpendSql()) {
      return [
        { corridor_id: HSR, spend_inr: "12000" },
        { corridor_id: ORR, spend_inr: "8000" },
        { corridor_id: null, spend_inr: "4500" },
      ];
    }
    if (sql === corridorEnquirySql()) {
      return [
        { corridor_id: HSR, enquiry_count: "24" },
        { corridor_id: null, enquiry_count: "9" },
      ];
    }
    if (sql === sourceWatermarkSql()) return [{ watermark: "2026-08-08 09:58:00.000" }];
    throw new Error(`unexpected sql: ${sql}`);
  });
}

beforeEach(() => {
  writeAttribution.mockReset().mockResolvedValue(undefined);
  readAttribution.mockReset().mockResolvedValue(null);
});

describe("S7 gate: per-corridor cost is real, not invented", () => {
  it("each corridor's cost follows only from its own spend and its own enquiries", async () => {
    const r = await rebuildAttribution(SCOPE, { query: mirror() as never, window: WINDOW, now: NOW });

    const hsr = r.corridors.find((c) => c.corridorId === HSR)!;
    expect(hsr.spendInr).toBe(12000);
    expect(hsr.enquiryCount).toBe(24);
    expect(hsr.costPerEnquiryInr).toBe(500);

    const orr = r.corridors.find((c) => c.corridorId === ORR)!;
    expect(orr.spendInr).toBe(8000);
    expect(orr.enquiryCount).toBe(0);
    expect(orr.costPerEnquiryInr).toBeNull();
  });

  it("unattributed spend and unattributed enquiries are their own reported figures", async () => {
    const r = await rebuildAttribution(SCOPE, { query: mirror() as never, window: WINDOW, now: NOW });
    expect(r.residual.unattributedSpendInr).toBe(4500);
    expect(r.residual.unattributedEnquiryCount).toBe(9);
    expect(r.residual.spendWithoutEnquiriesInr).toBe(8000);
    expect(r.residual.enquiriesWithoutSpendCount).toBe(0);
    expect(r.totals).toEqual({ spendInr: 24500, enquiryCount: 33 });
  });

  it("every fabrication of the residual is rejected", async () => {
    const r = await rebuildAttribution(SCOPE, { query: mirror() as never, window: WINDOW, now: NOW });

    const spread = {
      ...r,
      corridors: r.corridors.map((c) => {
        const spendInr = c.spendInr + r.residual.unattributedSpendInr / r.corridors.length;
        return {
          ...c,
          spendInr,
          costPerEnquiryInr: c.enquiryCount > 0 ? spendInr / c.enquiryCount : null,
        };
      }),
    };
    expect(() => assertConserved(spread)).toThrow(AttributionConservationError);

    const absorbed = {
      ...r,
      corridors: r.corridors.map((c, i) =>
        i === 0
          ? {
              ...c,
              enquiryCount: c.enquiryCount + r.residual.unattributedEnquiryCount,
              costPerEnquiryInr: c.spendInr / (c.enquiryCount + r.residual.unattributedEnquiryCount),
            }
          : c,
      ),
    };
    expect(() => assertConserved(absorbed)).toThrow(AttributionConservationError);

    const invented = {
      ...r,
      corridors: r.corridors.map((c) =>
        c.enquiryCount === 0 ? { ...c, costPerEnquiryInr: c.spendInr } : c,
      ),
    };
    expect(() => assertConserved(invented)).toThrow(/cost per enquiry/);

    const hidden = {
      ...r,
      residual: { ...r.residual, unattributedSpendInr: 0, unattributedEnquiryCount: 0 },
    };
    expect(() => assertConserved(hidden)).toThrow(AttributionConservationError);
  });

  it("writes only a conserved result, and carries its lag with it", async () => {
    await rebuildAttribution(SCOPE, { query: mirror() as never, window: WINDOW, now: NOW });
    const [, written, f] = writeAttribution.mock.calls[0];
    expect(() => assertConserved(written)).not.toThrow();
    expect(f.cdcLagSeconds).toBe(120);
    expect(f.isStale).toBe(false);
  });

  it("the per-space figure is an allocation that conserves the corridor total", async () => {
    const r = await rebuildAttribution(SCOPE, { query: mirror() as never, window: WINDOW, now: NOW });
    const hsr = r.corridors.find((c) => c.corridorId === HSR)!;
    const rows = allocateEqualSplit({
      corridorId: HSR,
      spendInr: hsr.spendInr,
      enquiryCount: hsr.enquiryCount,
      listingIds: ["l1", "l2", "l3", "l4"],
    });

    expect(rows.every((x) => x.isEstimate)).toBe(true);
    expect(rows.reduce((t, x) => t + x.estimatedSpendShareInr, 0)).toBeCloseTo(hsr.spendInr, 9);
  });

  it("a derived attribution figure cannot justify a proposal on its own", () => {
    expect(() =>
      assertNotSoleDerivedJustification([
        { authority: "derived", ref: "derived.corridor_attribution_daily:hsr" },
      ]),
    ).toThrow(DerivedOnlyJustificationError);

    expect(() =>
      assertNotSoleDerivedJustification([
        { authority: "derived", ref: "derived.corridor_attribution_daily:hsr" },
        { authority: "record", ref: "adsagent.campaigns:1" },
      ]),
    ).not.toThrow();
  });
});
