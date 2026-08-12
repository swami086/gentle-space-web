// ads-agent/mcp/context-server/read-enquiries.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const txQuery = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({
  withAgentTenantTx: async (_orgId: string, fn: (tx: { query: typeof txQuery }) => Promise<unknown>) =>
    fn({ query: txQuery }),
}));

import { getEnquiry, listEnquiries } from "./read-enquiries";

const CLAIMS = {
  orgId: "11111111-1111-1111-1111-111111111111",
  taskId: "task-1",
  profile: "leads",
  toolAllowlist: ["list_enquiries", "get_enquiry"],
};
const ENQ = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listEnquiries", () => {
  it("reads the tenant-scoped view and never the base table", async () => {
    txQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await listEnquiries(CLAIMS, {});
    const sql = String(txQuery.mock.calls[0][0]);
    expect(sql).toContain("context.v_agent_enquiries");
    expect(sql).not.toContain("adsagent.enquiries");
  });

  it("binds status and since as parameters and caps the limit", async () => {
    txQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await listEnquiries(CLAIMS, { status: "waiting", since: "2026-08-01T00:00:00.000Z", limit: 9999 });
    const [, params] = txQuery.mock.calls[0];
    expect(params).toContain("waiting");
    expect(params).toContain("2026-08-01T00:00:00.000Z");
    expect(params).toContain(100);
  });

  it("maps rows to camelCase ISO summaries", async () => {
    txQuery.mockResolvedValue({
      rows: [
        {
          id: ENQ,
          contact_name: "Asha",
          reply_state: "waiting",
          corridor_id: null,
          listing_id: null,
          first_seen_at: new Date("2026-08-10T10:00:00.000Z"),
          last_activity_at: new Date("2026-08-11T10:00:00.000Z"),
        },
      ],
      rowCount: 1,
    });
    const rows = await listEnquiries(CLAIMS, {});
    expect(rows).toEqual([
      {
        id: ENQ,
        contactName: "Asha",
        replyState: "waiting",
        corridorId: null,
        listingId: null,
        firstSeenAt: "2026-08-10T10:00:00.000Z",
        lastActivityAt: "2026-08-11T10:00:00.000Z",
      },
    ]);
  });
});

describe("getEnquiry", () => {
  it("returns null when the view yields no row, so another tenant's id is not-found", async () => {
    txQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await getEnquiry(CLAIMS, ENQ)).toBeNull();
  });

  it("returns the thread, activity and derived signals for an in-tenant enquiry", async () => {
    txQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: ENQ,
            contact_name: "Asha",
            reply_state: "waiting",
            corridor_id: null,
            listing_id: null,
            first_seen_at: new Date("2026-08-10T10:00:00.000Z"),
            last_activity_at: new Date("2026-08-11T10:00:00.000Z"),
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          { id: "a1", kind: "pricing_question", occurred_at: new Date("2026-08-10T11:00:00.000Z"), summary: null },
          { id: "a2", kind: "pricing_question", occurred_at: new Date("2026-08-10T12:00:00.000Z"), summary: null },
        ],
        rowCount: 2,
      });
    const detail = await getEnquiry(CLAIMS, ENQ);
    expect(detail?.activity).toHaveLength(2);
    expect(detail?.signals).toContain("pricing_question x2");
  });

  it("rejects a malformed id before querying", async () => {
    await expect(getEnquiry(CLAIMS, "not-a-uuid")).rejects.toThrow("invalid_enquiry_id");
    expect(txQuery).not.toHaveBeenCalled();
  });
});
