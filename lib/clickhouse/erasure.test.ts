import { describe, it, expect, vi, beforeEach } from "vitest";

const chExec = vi.fn().mockResolvedValue(undefined);
vi.mock("./client", () => ({ chExec: (...a: unknown[]) => chExec(...a) }));

const query = vi.fn().mockResolvedValue({ rows: [] });
vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const REQUEST = "rrrrrrrr-0000-4000-8000-00000000000r";

beforeEach(() => {
  chExec.mockClear();
  query.mockClear();
});

describe("eraseSubject", () => {
  const input = { orgId: ORG, requestId: REQUEST, enquiryIds: ["eeeeeeee-0000-4000-8000-00000000000e"], sessionIds: ["sess-1", "sess-2"] };

  it("deletes every linked session's raw events, not just the enquiry row", async () => {
    const { eraseSubject } = await import("./erasure");
    await eraseSubject(input);
    const rawDelete = chExec.mock.calls.map(([sql]) => String(sql)).find((s) => s.includes("raw.portal_events"));
    expect(rawDelete?.replace(/\s+/g, " ")).toContain("ALTER TABLE raw.portal_events DELETE");
    expect(rawDelete).toContain("session_id IN");
    const params = (chExec.mock.calls.find(([sql]) => String(sql).includes("raw.portal_events")) as [string, { params: Record<string, string> }])[1].params;
    expect(JSON.parse(params.sessions)).toEqual(["sess-1", "sess-2"]);
    expect(params.org).toBe(ORG);
  });

  it("deletes the enquiry from the analytical mirror too", async () => {
    const { eraseSubject } = await import("./erasure");
    await eraseSubject(input);
    expect(chExec.mock.calls.map(([sql]) => String(sql)).some((s) => s.includes("analytics.enquiry_fact"))).toBe(true);
  });

  it("waits for the mutation instead of assuming it finished", async () => {
    const { eraseSubject } = await import("./erasure");
    await eraseSubject(input);
    expect(chExec.mock.calls.every(([sql]) => String(sql).includes("mutations_sync = 2"))).toBe(true);
  });

  it("records propagation for clickhouse_raw, clickhouse, and gcs_raw", async () => {
    const { eraseSubject } = await import("./erasure");
    await eraseSubject(input);
    const stores = query.mock.calls.filter(([sql]) => String(sql).includes("deletion_propagations")).map(([, p]) => (p as unknown[])[1]);
    expect(stores).toContain("clickhouse_raw");
    expect(stores).toContain("clickhouse");
    expect(stores).toContain("gcs_raw");
  });

  it("never touches consent records: they are the evidence collection was lawful", async () => {
    const { eraseSubject } = await import("./erasure");
    await eraseSubject(input);
    const touched = [...chExec.mock.calls, ...query.mock.calls].map(([sql]) => String(sql)).join(" ");
    expect(touched).not.toContain("consent_records");
  });

  it("does nothing to the raw zone when no session was ever linked", async () => {
    const { eraseSubject } = await import("./erasure");
    await eraseSubject({ ...input, sessionIds: [] });
    expect(chExec.mock.calls.map(([sql]) => String(sql)).some((s) => s.includes("raw.portal_events"))).toBe(false);
  });
});
