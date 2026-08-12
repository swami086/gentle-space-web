import { describe, it, expect } from "vitest";
import { allocateEqualSplit } from "./allocation";

const CORRIDOR = "44444444-4444-4444-4444-444444444444";

describe("allocateEqualSplit", () => {
  it("splits corridor spend equally and labels every row an estimate", () => {
    const rows = allocateEqualSplit({
      corridorId: CORRIDOR,
      spendInr: 3000,
      enquiryCount: 6,
      listingIds: ["l1", "l2", "l3"],
    });

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.isEstimate).toBe(true);
      expect(row.basis).toBe("equal_split");
      expect(row.corridorId).toBe(CORRIDOR);
      expect(row.estimatedSpendShareInr).toBe(1000);
      expect(row.estimatedCostPerEnquiryInr).toBe(500);
    }
  });

  it("conserves spend exactly — the shares sum back to the corridor total", () => {
    const rows = allocateEqualSplit({
      corridorId: CORRIDOR,
      spendInr: 1000,
      enquiryCount: 3,
      listingIds: ["l1", "l2", "l3"],
    });
    const summed = rows.reduce((t, r) => t + r.estimatedSpendShareInr, 0);
    expect(summed).toBeCloseTo(1000, 9);
  });

  it("returns no rows when the corridor has no listings rather than dividing by zero", () => {
    expect(
      allocateEqualSplit({ corridorId: CORRIDOR, spendInr: 5000, enquiryCount: 2, listingIds: [] }),
    ).toEqual([]);
  });

  it("gives a null cost per enquiry when the corridor has no enquiries, never zero", () => {
    const [row] = allocateEqualSplit({
      corridorId: CORRIDOR,
      spendInr: 5000,
      enquiryCount: 0,
      listingIds: ["l1"],
    });
    expect(row.estimatedSpendShareInr).toBe(5000);
    expect(row.estimatedCostPerEnquiryInr).toBeNull();
  });

  it("rejects negative spend rather than allocating it", () => {
    expect(() =>
      allocateEqualSplit({ corridorId: CORRIDOR, spendInr: -1, enquiryCount: 1, listingIds: ["l1"] }),
    ).toThrow(/negative spend/);
  });
});
