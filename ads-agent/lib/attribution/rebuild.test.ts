import { describe, it, expect, vi, beforeEach } from "vitest";

const { writeAttribution, readAttribution } = vi.hoisted(() => ({
  writeAttribution: vi.fn(),
  readAttribution: vi.fn(),
}));
vi.mock("../db/attribution", () => ({ writeAttribution, readAttribution }));

import { corridorEnquirySql, corridorSpendSql, sourceWatermarkSql } from "./analytical-source";
import { rebuildAttribution } from "./rebuild";

const ORG = "88888888-8888-8888-8888-888888888888";
const SCOPE = { kind: "org" as const, orgId: ORG };
const WINDOW = { startDate: "2026-08-01", endDate: "2026-08-07" };
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function fakeQuery(opts: { spend: unknown[]; enquiries: unknown[]; watermark: string }) {
  return vi.fn(async (sql: string) => {
    if (sql === corridorSpendSql()) return opts.spend;
    if (sql === corridorEnquirySql()) return opts.enquiries;
    if (sql === sourceWatermarkSql()) return [{ watermark: opts.watermark }];
    throw new Error(`unexpected sql: ${sql}`);
  });
}

beforeEach(() => {
  writeAttribution.mockReset().mockResolvedValue(undefined);
  readAttribution.mockReset().mockResolvedValue(null);
});

describe("rebuildAttribution on an open window", () => {
  it("reconciles the mirror and writes the result with its freshness", async () => {
    const query = fakeQuery({
      spend: [
        { corridor_id: A, spend_inr: "1000" },
        { corridor_id: null, spend_inr: "600" },
      ],
      enquiries: [{ corridor_id: A, enquiry_count: "4" }],
      watermark: "2026-08-12 09:59:00.000",
    });

    const result = await rebuildAttribution(SCOPE, {
      query: query as never,
      window: WINDOW,
      now: new Date("2026-08-12T10:00:00Z"),
    });

    expect(result.windowState).toBe("open");
    expect(result.corridors[0]).toEqual({
      corridorId: A,
      spendInr: 1000,
      enquiryCount: 4,
      costPerEnquiryInr: 250,
    });
    expect(result.residual.unattributedSpendInr).toBe(600);

    const [, written, f] = writeAttribution.mock.calls[0];
    expect(written).toEqual(result);
    expect(f.cdcLagSeconds).toBe(60);
    expect(f.isStale).toBe(false);
  });

  it("still writes when the mirror is stale, labelled rather than suppressed", async () => {
    const query = fakeQuery({
      spend: [{ corridor_id: A, spend_inr: "1000" }],
      enquiries: [{ corridor_id: A, enquiry_count: "4" }],
      watermark: "2026-08-12 08:00:00.000",
    });

    await rebuildAttribution(SCOPE, {
      query: query as never,
      window: WINDOW,
      now: new Date("2026-08-12T10:00:00Z"),
    });

    const [, , f] = writeAttribution.mock.calls[0];
    expect(f.cdcLagSeconds).toBe(7200);
    expect(f.isStale).toBe(true);
    expect(writeAttribution).toHaveBeenCalledTimes(1);
  });
});

describe("rebuildAttribution on a closed window", () => {
  const CLOSED = { startDate: "2026-07-01", endDate: "2026-07-07" };

  it("keeps the frozen figures and records the late arrivals", async () => {
    readAttribution.mockResolvedValue({
      window: CLOSED,
      windowState: "closed",
      corridors: [
        { corridorId: A, spendInr: 1000, enquiryCount: 4, costPerEnquiryInr: 250, authority: "derived" },
      ],
      residual: {
        unattributedSpendInr: 0,
        unattributedEnquiryCount: 0,
        spendWithoutEnquiriesInr: 0,
        enquiriesWithoutSpendCount: 0,
      },
      lateEnquiryCount: 0,
      totals: { spendInr: 1000, enquiryCount: 4 },
      freshness: {
        computedAt: "2026-07-08T00:00:00.000Z",
        sourceWatermark: "2026-07-08T00:00:00.000Z",
        cdcLagSeconds: 0,
        isStale: false,
      },
      authority: "derived",
    });

    const query = fakeQuery({
      spend: [{ corridor_id: A, spend_inr: "1000" }],
      enquiries: [{ corridor_id: A, enquiry_count: "9" }],
      watermark: "2026-08-12 09:59:00.000",
    });

    const result = await rebuildAttribution(SCOPE, {
      query: query as never,
      window: CLOSED,
      now: new Date("2026-08-12T10:00:00Z"),
    });

    expect(result.corridors[0].enquiryCount).toBe(4);
    expect(result.corridors[0].costPerEnquiryInr).toBe(250);
    expect(result.lateEnquiryCount).toBe(5);
  });

  it("computes from scratch when a closed window has never been stored", async () => {
    readAttribution.mockResolvedValue(null);
    const query = fakeQuery({
      spend: [{ corridor_id: A, spend_inr: "800" }],
      enquiries: [{ corridor_id: A, enquiry_count: "2" }],
      watermark: "2026-08-12 09:59:00.000",
    });

    const result = await rebuildAttribution(SCOPE, {
      query: query as never,
      window: CLOSED,
      now: new Date("2026-08-12T10:00:00Z"),
    });

    expect(result.corridors[0].costPerEnquiryInr).toBe(400);
    expect(result.lateEnquiryCount).toBe(0);
  });
});
