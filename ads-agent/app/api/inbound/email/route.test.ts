import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyPostmarkBasicAuth, insertInboundEvent, withTenantTransaction } = vi.hoisted(() => ({
  verifyPostmarkBasicAuth: vi.fn(),
  insertInboundEvent: vi.fn(),
  withTenantTransaction: vi.fn(),
}));

vi.mock("@/lib/inbound/postmark-auth", () => ({
  verifyPostmarkBasicAuth,
}));

vi.mock("@/lib/db/inbound-events", () => ({
  insertInboundEvent,
}));

vi.mock("@/lib/db/tx", () => ({
  withTenantTransaction,
}));

import { POST } from "./route";

function jsonRequest(body: unknown, headers: HeadersInit = {}): Request {
  return new Request("http://example.com/api/inbound/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const PLATFORM_ORG_ID = "00000000-0000-0000-0000-000000000001";

describe("POST /api/inbound/email", () => {
  beforeEach(() => {
    Object.assign(process.env, {
      PLATFORM_ORG_ID,
      POSTMARK_INBOUND_USER: "postmark-user",
      POSTMARK_INBOUND_PASS: "postmark-pass",
    });

    verifyPostmarkBasicAuth.mockReset();
    insertInboundEvent.mockReset();
    withTenantTransaction.mockReset();
  });

  it("returns 401 when Basic auth verification fails", async () => {
    verifyPostmarkBasicAuth.mockReturnValue(false);

    const res = await POST(
      jsonRequest(
        { MessageID: "msg-1", Subject: "Hello" },
        { Authorization: "Basic something" },
      ),
    );

    expect(res.status).toBe(401);
    expect(verifyPostmarkBasicAuth).toHaveBeenCalledWith(
      "Basic something",
      "postmark-user",
      "postmark-pass",
    );
    expect(withTenantTransaction).not.toHaveBeenCalled();
    expect(insertInboundEvent).not.toHaveBeenCalled();
  });

  it("inserts inbound event for valid auth and JSON body", async () => {
    verifyPostmarkBasicAuth.mockReturnValue(true);
    withTenantTransaction.mockImplementation(async (scope: unknown, fn: (client: unknown) => Promise<unknown>) => {
      const client = {};
      return fn(client);
    });
    insertInboundEvent.mockResolvedValue({ id: "evt-1", inserted: true });

    const payload = { MessageID: "msg-123", Subject: "Test", TextBody: "hello" };

    const res = await POST(
      jsonRequest(payload, {
        Authorization: "Basic good",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ inserted: true });

    expect(withTenantTransaction).toHaveBeenCalledTimes(1);
    const [scope] = withTenantTransaction.mock.calls[0];
    expect(scope).toEqual({ kind: "org", orgId: PLATFORM_ORG_ID });

    expect(insertInboundEvent).toHaveBeenCalledWith(scope, expect.any(Object), {
      channel: "email",
      externalId: "msg-123",
      payload,
    });
  });

  it("treats deduplicated events as success with inserted=false", async () => {
    verifyPostmarkBasicAuth.mockReturnValue(true);
    withTenantTransaction.mockImplementation(async (_scope: unknown, fn: (client: unknown) => Promise<unknown>) => {
      const client = {};
      return fn(client);
    });
    insertInboundEvent.mockResolvedValue({ id: "", inserted: false });

    const res = await POST(
      jsonRequest({ MessageID: "duplicate-id" }, { Authorization: "Basic good" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ inserted: false });
  });

  it("returns 400 when MessageID is missing", async () => {
    verifyPostmarkBasicAuth.mockReturnValue(true);

    const res = await POST(
      jsonRequest({ Subject: "No id" }, { Authorization: "Basic good" }),
    );

    expect(res.status).toBe(400);
    expect(insertInboundEvent).not.toHaveBeenCalled();
  });

  it("returns 500 when Postmark credentials are not configured", async () => {
    delete process.env.POSTMARK_INBOUND_USER;
    delete process.env.POSTMARK_INBOUND_PASS;

    const res = await POST(
      jsonRequest({ MessageID: "msg-1" }, { Authorization: "Basic something" }),
    );

    expect(res.status).toBe(500);
    expect(verifyPostmarkBasicAuth).not.toHaveBeenCalled();
    expect(insertInboundEvent).not.toHaveBeenCalled();
  });
});
