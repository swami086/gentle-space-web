import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));

const chExec = vi.fn();
const chQuery = vi.fn();
vi.mock("./client", () => ({
  chExec: (...args: unknown[]) => chExec(...args),
  chQuery: (...args: unknown[]) => chQuery(...args),
  clickhouseConfig: () => ({ url: "http://x:8123", user: "etl_writer", password: "p", target: "local" }),
}));

beforeEach(() => {
  query.mockReset();
  chExec.mockReset().mockResolvedValue(undefined);
  chQuery.mockReset().mockResolvedValue([{ copied: "3" }]);
});

describe("readWatermark", () => {
  it("returns the epoch when no state row exists, so the first run is a full copy", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { readWatermark } = await import("./replicate");
    expect(await readWatermark("adsagent.enquiries")).toBe("1970-01-01 00:00:00.000");
  });
});

describe("replicateEnquiries", () => {
  it("copies the half-open window (watermark, cutoff] and advances the watermark to the cutoff", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ cutoff: "2026-08-12 09:00:00.000" }] })   // computeCutoff
      .mockResolvedValueOnce({ rows: [{ watermark: "2026-08-12 08:00:00.000" }] }) // readWatermark
      .mockResolvedValueOnce({ rows: [] })                                        // access_log
      .mockResolvedValueOnce({ rows: [] });                                       // writeWatermark

    const { replicateEnquiries } = await import("./replicate");
    const result = await replicateEnquiries({ toleranceSeconds: 120 });

    const [sql, options] = chQuery.mock.calls[0] as [string, { params: Record<string, string> }];
    expect(sql).toContain("INSERT INTO analytics.enquiry_fact");
    expect(sql).toContain("postgresql(");
    expect(sql).toContain("updated_at > {watermark:DateTime64(3)}");
    expect(sql).toContain("updated_at <= {cutoff:DateTime64(3)}");
    expect(options.params.watermark).toBe("2026-08-12 08:00:00.000");
    expect(options.params.cutoff).toBe("2026-08-12 09:00:00.000");
    expect(result).toEqual({ table: "adsagent.enquiries", rowsCopied: 3, watermark: "2026-08-12 09:00:00.000" });
  });

  it("audits itself as a cross-tenant actor, because it reads every tenant's rows", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ cutoff: "2026-08-12 09:00:00.000" }] })
      .mockResolvedValueOnce({ rows: [{ watermark: "2026-08-12 08:00:00.000" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { replicateEnquiries } = await import("./replicate");
    await replicateEnquiries();

    const auditCall = query.mock.calls.find(([sql]) => String(sql).includes("context.access_log"));
    expect(auditCall, "replication must write a cross_tenant access_log row").toBeDefined();
    expect(auditCall?.[1]).toContain("cross_tenant");
    expect(auditCall?.[1]).toContain("cdc-replicator");
  });
});
