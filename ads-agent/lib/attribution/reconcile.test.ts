import { describe, it, expect } from "vitest";
import {
  applyFrozenWindow,
  assertConserved,
  AttributionConservationError,
  reconcile,
  type AttributionResult,
} from "./reconcile";

const WINDOW = { startDate: "2026-08-01", endDate: "2026-08-07" };
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function run(
  spend: { corridorId: string | null; spendInr: number }[],
  enquiries: { corridorId: string | null; enquiryCount: number }[],
): AttributionResult {
  return reconcile({ window: WINDOW, windowState: "open", spend, enquiries });
}

describe("reconcile", () => {
  it("computes cost per enquiry per corridor", () => {
    const r = run([{ corridorId: A, spendInr: 2000 }], [{ corridorId: A, enquiryCount: 4 }]);
    expect(r.corridors).toEqual([
      { corridorId: A, spendInr: 2000, enquiryCount: 4, costPerEnquiryInr: 500 },
    ]);
    expect(r.totals).toEqual({ spendInr: 2000, enquiryCount: 4 });
  });

  it("reports spend with no corridor as its own figure, never spread across corridors", () => {
    const r = run(
      [
        { corridorId: A, spendInr: 1000 },
        { corridorId: B, spendInr: 1000 },
        { corridorId: null, spendInr: 600 },
      ],
      [
        { corridorId: A, enquiryCount: 2 },
        { corridorId: B, enquiryCount: 2 },
      ],
    );

    expect(r.corridors.map((c) => c.spendInr)).toEqual([1000, 1000]);
    expect(r.corridors.map((c) => c.costPerEnquiryInr)).toEqual([500, 500]);
    expect(r.residual.unattributedSpendInr).toBe(600);
    expect(r.totals.spendInr).toBe(2600);
  });

  it("reports enquiries with no corridor as their own figure", () => {
    const r = run(
      [{ corridorId: A, spendInr: 1000 }],
      [
        { corridorId: A, enquiryCount: 2 },
        { corridorId: null, enquiryCount: 5 },
      ],
    );
    expect(r.corridors[0].enquiryCount).toBe(2);
    expect(r.corridors[0].costPerEnquiryInr).toBe(500);
    expect(r.residual.unattributedEnquiryCount).toBe(5);
    expect(r.totals.enquiryCount).toBe(7);
  });

  it("gives null cost per enquiry — never zero, never the spend — for a corridor with no enquiries", () => {
    const r = run([{ corridorId: A, spendInr: 900 }], []);
    expect(r.corridors[0]).toEqual({
      corridorId: A,
      spendInr: 900,
      enquiryCount: 0,
      costPerEnquiryInr: null,
    });
    expect(r.residual.spendWithoutEnquiriesInr).toBe(900);
  });

  it("keeps a corridor with enquiries and no spend, and counts it separately", () => {
    const r = run([], [{ corridorId: A, enquiryCount: 3 }]);
    expect(r.corridors[0]).toEqual({
      corridorId: A,
      spendInr: 0,
      enquiryCount: 3,
      costPerEnquiryInr: 0,
    });
    expect(r.residual.enquiriesWithoutSpendCount).toBe(3);
  });

  it("sums duplicate rows for the same corridor", () => {
    const r = run(
      [
        { corridorId: A, spendInr: 100 },
        { corridorId: A, spendInr: 250 },
      ],
      [
        { corridorId: A, enquiryCount: 1 },
        { corridorId: A, enquiryCount: 6 },
      ],
    );
    expect(r.corridors[0].spendInr).toBe(350);
    expect(r.corridors[0].enquiryCount).toBe(7);
  });

  it("orders corridors by spend descending so the biggest number is not buried", () => {
    const r = run(
      [
        { corridorId: A, spendInr: 100 },
        { corridorId: B, spendInr: 900 },
      ],
      [],
    );
    expect(r.corridors.map((c) => c.corridorId)).toEqual([B, A]);
  });

  it("rejects a negative spend row instead of netting it off another corridor", () => {
    expect(() => run([{ corridorId: A, spendInr: -10 }], [])).toThrow(/negative spend/);
  });
});

describe("assertConserved", () => {
  it("passes a reconciliation produced by reconcile", () => {
    const r = run(
      [
        { corridorId: A, spendInr: 1000 },
        { corridorId: null, spendInr: 600 },
      ],
      [
        { corridorId: A, enquiryCount: 2 },
        { corridorId: null, enquiryCount: 5 },
      ],
    );
    expect(() => assertConserved(r)).not.toThrow();
  });

  it("throws when unattributed spend is spread across corridors — the plausible fabrication", () => {
    const r = run(
      [
        { corridorId: A, spendInr: 1000 },
        { corridorId: B, spendInr: 1000 },
        { corridorId: null, spendInr: 600 },
      ],
      [
        { corridorId: A, enquiryCount: 2 },
        { corridorId: B, enquiryCount: 2 },
      ],
    );

    const fabricated: AttributionResult = {
      ...r,
      corridors: r.corridors.map((c) => ({
        ...c,
        spendInr: c.spendInr + r.residual.unattributedSpendInr / r.corridors.length,
        costPerEnquiryInr:
          (c.spendInr + r.residual.unattributedSpendInr / r.corridors.length) / c.enquiryCount,
      })),
    };

    expect(() => assertConserved(fabricated)).toThrow(AttributionConservationError);
    expect(() => assertConserved(fabricated)).toThrow(/spend/);
  });

  it("throws when the residual is quietly dropped instead of reported", () => {
    const r = run([{ corridorId: null, spendInr: 600 }], [{ corridorId: null, enquiryCount: 5 }]);
    const hidden: AttributionResult = {
      ...r,
      residual: { ...r.residual, unattributedSpendInr: 0, unattributedEnquiryCount: 0 },
    };
    expect(() => assertConserved(hidden)).toThrow(AttributionConservationError);
  });

  it("throws when a cost per enquiry does not follow from its own spend and count", () => {
    const r = run([{ corridorId: A, spendInr: 1000 }], [{ corridorId: A, enquiryCount: 4 }]);
    const wrong: AttributionResult = {
      ...r,
      corridors: [{ ...r.corridors[0], costPerEnquiryInr: 120 }],
    };
    expect(() => assertConserved(wrong)).toThrow(/cost per enquiry/);
  });

  it("throws when a corridor with no enquiries carries a cost per enquiry", () => {
    const r = run([{ corridorId: A, spendInr: 900 }], []);
    const wrong: AttributionResult = {
      ...r,
      corridors: [{ ...r.corridors[0], costPerEnquiryInr: 900 }],
    };
    expect(() => assertConserved(wrong)).toThrow(/cost per enquiry/);
  });
});

describe("applyFrozenWindow", () => {
  const frozen = reconcile({
    window: WINDOW,
    windowState: "closed",
    spend: [{ corridorId: A, spendInr: 1000 }],
    enquiries: [{ corridorId: A, enquiryCount: 4 }],
  });

  it("keeps the frozen figures and reports the late arrivals separately", () => {
    const fresh = reconcile({
      window: WINDOW,
      windowState: "closed",
      spend: [{ corridorId: A, spendInr: 1000 }],
      enquiries: [{ corridorId: A, enquiryCount: 7 }],
    });

    const merged = applyFrozenWindow(frozen, fresh);
    expect(merged.corridors[0].enquiryCount).toBe(4);
    expect(merged.corridors[0].costPerEnquiryInr).toBe(250);
    expect(merged.lateEnquiryCount).toBe(3);
    expect(() => assertConserved(merged)).not.toThrow();
  });

  it("reports zero late arrivals when nothing new landed", () => {
    expect(applyFrozenWindow(frozen, frozen).lateEnquiryCount).toBe(0);
  });

  it("never reports a negative late count when rows have been erased", () => {
    const fewer = reconcile({
      window: WINDOW,
      windowState: "closed",
      spend: [{ corridorId: A, spendInr: 1000 }],
      enquiries: [{ corridorId: A, enquiryCount: 1 }],
    });
    expect(applyFrozenWindow(frozen, fewer).lateEnquiryCount).toBe(0);
  });

  it("refuses to freeze a window that is still open", () => {
    const open = reconcile({ window: WINDOW, windowState: "open", spend: [], enquiries: [] });
    expect(() => applyFrozenWindow(open, open)).toThrow(/closed/);
  });
});
