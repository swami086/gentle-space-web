import { describe, it, expect } from "vitest";
import { expiredPartitions } from "./retention";

const windows = [
  { purpose: "site_analytics", retentionDays: 90 },
  { purpose: "space_recommendation", retentionDays: 180 },
  { purpose: "enquiry_handling", retentionDays: 365 },
];
const today = new Date("2026-08-12T00:00:00.000Z");

describe("expiredPartitions", () => {
  it("keeps a partition inside its purpose's window", () => {
    expect(
      expiredPartitions(windows, [{ partition: "('site_analytics','2026-07-01')", purpose: "site_analytics", occurred_on: "2026-07-01" }], today),
    ).toEqual([]);
  });

  it("expires a partition past its purpose's window", () => {
    expect(
      expiredPartitions(windows, [{ partition: "('site_analytics','2026-01-01')", purpose: "site_analytics", occurred_on: "2026-01-01" }], today),
    ).toEqual(["('site_analytics','2026-01-01')"]);
  });

  it("applies each purpose's own window, not one global window", () => {
    const partitions = [
      { partition: "('site_analytics','2026-04-01')", purpose: "site_analytics", occurred_on: "2026-04-01" },
      { partition: "('enquiry_handling','2026-04-01')", purpose: "enquiry_handling", occurred_on: "2026-04-01" },
    ];
    expect(expiredPartitions(windows, partitions, today)).toEqual(["('site_analytics','2026-04-01')"]);
  });

  it("never expires a partition whose purpose has no configured window", () => {
    expect(
      expiredPartitions(windows, [{ partition: "('mystery','2020-01-01')", purpose: "mystery", occurred_on: "2020-01-01" }], today),
    ).toEqual([]);
  });
});
