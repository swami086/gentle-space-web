import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  countEnquiriesByState,
  createEnquiry,
  getEnquiryById,
  listEnquiries,
  setReplyState,
  setTwentyOpportunityId,
} from "./enquiries";

const scope: Scope = { kind: "org", orgId: "org-1" };

const row = {
  id: "enq-1",
  org_id: "org-1",
  contact_id: "contact-1",
  twenty_opportunity_id: null,
  listing_id: null,
  listing_url: "https://gentlespace.in/spaces/hsr-1",
  corridor_id: null,
  reply_state: "waiting",
  contact_name: "Asha Rao",
  contact_phone: "+919800000000",
  contact_email: null,
  first_seen_at: new Date("2026-08-12T04:00:00.000Z"),
  last_activity_at: new Date("2026-08-12T04:00:00.000Z"),
  lifecycle: "active",
  created_at: new Date("2026-08-12T04:00:00.000Z"),
};

beforeEach(() => query.mockReset());

describe("createEnquiry", () => {
  it("commits with no Twenty identifier and starts in the waiting state", async () => {
    query.mockResolvedValue({ rows: [row] });
    const enquiry = await createEnquiry(scope, {
      contactId: "contact-1",
      contactName: "Asha Rao",
      contactPhone: "+919800000000",
      listingUrl: "https://gentlespace.in/spaces/hsr-1",
    });
    expect(enquiry.replyState).toBe("waiting");
    expect(enquiry.twentyOpportunityId).toBeNull();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.enquiries");
    const insertedColumns = sql.match(/INSERT INTO adsagent\.enquiries\s*\(([^)]*)\)/)?.[1] ?? "";
    expect(insertedColumns).not.toContain("twenty_opportunity_id");
    expect(params).toEqual([
      "org-1",
      "contact-1",
      null,
      "https://gentlespace.in/spaces/hsr-1",
      "Asha Rao",
      "+919800000000",
      null,
    ]);
  });

  it("refuses platform scope", async () => {
    await expect(
      createEnquiry({ kind: "platform", orgId: "org-1" }, { contactId: null, contactName: "Asha Rao" }),
    ).rejects.toThrow(/platform scope cannot write/i);
  });
});

describe("listEnquiries", () => {
  it("returns only active rows, newest activity first", async () => {
    query.mockResolvedValue({ rows: [row] });
    await listEnquiries(scope);
    const [sql] = query.mock.calls[0];
    expect(sql).toContain("lifecycle = 'active'");
    expect(sql).toContain("ORDER BY last_activity_at DESC");
  });

  it("filters by reply state when asked", async () => {
    query.mockResolvedValue({ rows: [] });
    await listEnquiries(scope, { replyState: "called", limit: 10 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("reply_state = $2");
    expect(params).toEqual(["org-1", "called", 10]);
  });
});

describe("getEnquiryById", () => {
  it("returns null for another tenant's id, which the route turns into a 404", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getEnquiryById(scope, "enq-other")).resolves.toBeNull();
  });

  it("hides a suppressed enquiry from ordinary reads", async () => {
    query.mockResolvedValue({ rows: [] });
    await getEnquiryById(scope, "enq-1");
    expect(query.mock.calls[0][0]).toContain("lifecycle = 'active'");
  });
});

describe("setReplyState", () => {
  it("updates the state and the activity clock together", async () => {
    query.mockResolvedValue({ rows: [{ ...row, reply_state: "called" }] });
    const updated = await setReplyState(scope, "enq-1", "called");
    expect(updated?.replyState).toBe("called");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/reply_state\s*=\s*\$\d+/);
    expect(sql).toMatch(/last_activity_at\s*=\s*now\(\)/);
    expect(params).toEqual(["org-1", "called", "enq-1"]);
  });
});

describe("setTwentyOpportunityId", () => {
  it("writes back the projection reference", async () => {
    query.mockResolvedValue({ rows: [] });
    await setTwentyOpportunityId(scope, "enq-1", "opp-9");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/twenty_opportunity_id\s*=\s*\$\d+/);
    expect(params).toEqual(["org-1", "opp-9", "enq-1"]);
  });
});

describe("countEnquiriesByState", () => {
  it("returns a zero for every state the badge can show", async () => {
    query.mockResolvedValue({ rows: [{ reply_state: "waiting", n: "3" }] });
    await expect(countEnquiriesByState(scope)).resolves.toEqual({
      waiting: 3,
      called: 0,
      closed: 0,
    });
  });
});
