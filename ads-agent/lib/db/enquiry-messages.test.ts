import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import type { Scope } from "./scope-sql";
import { addMessage, listMessages } from "./enquiry-messages";

const scope: Scope = { kind: "org", orgId: "org-1" };

const row = {
  id: "msg-1",
  org_id: "org-1",
  enquiry_id: "enq-1",
  channel: "web_form",
  body: "Looking for 38 desks in HSR",
  external_id: null,
  reply_token: null,
  is_untrusted: true,
  received_at: new Date("2026-08-12T04:00:00.000Z"),
};

beforeEach(() => query.mockReset());

describe("addMessage", () => {
  it("records the channel so the screen can label the source", async () => {
    query.mockResolvedValue({ rows: [row] });
    const message = await addMessage(scope, {
      enquiryId: "enq-1",
      channel: "web_form",
      body: "Looking for 38 desks in HSR",
    });
    expect(message.channel).toBe("web_form");
    expect(message.isUntrusted).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.enquiry_messages");
    expect(params).toEqual([
      "org-1",
      "enq-1",
      "web_form",
      "Looking for 38 desks in HSR",
      null,
      null,
      null,
    ]);
  });

  it("is idempotent on a provider message id, so a redelivery is a no-op", async () => {
    query.mockResolvedValue({ rows: [row] });
    await addMessage(scope, {
      enquiryId: "enq-1",
      channel: "email",
      body: "hi",
      externalId: "provider-7",
    });
    expect(query.mock.calls[0][0]).toContain(
      "ON CONFLICT (org_id, channel, external_id) DO UPDATE",
    );
  });

  it("refuses platform scope", async () => {
    await expect(
      addMessage(
        { kind: "platform", orgId: "org-1" },
        { enquiryId: "enq-1", channel: "web_form", body: "hi" },
      ),
    ).rejects.toThrow(/platform scope cannot write/i);
  });
});

describe("listMessages", () => {
  it("returns the thread newest first, scoped to the org", async () => {
    query.mockResolvedValue({ rows: [row] });
    const messages = await listMessages(scope, "enq-1");
    expect(messages).toHaveLength(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("ORDER BY received_at DESC");
    expect(params).toEqual(["org-1", "enq-1", 200]);
  });
});
