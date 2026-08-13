import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, enqueueEvent, withCrossTenantRead, withTenantTransaction } = vi.hoisted(() => ({
  query: vi.fn(),
  enqueueEvent: vi.fn(),
  withCrossTenantRead: vi.fn(),
  withTenantTransaction: vi.fn(),
}));

vi.mock("./outbox", () => ({ enqueueEvent }));
vi.mock("./cross-tenant", () => ({ withCrossTenantRead }));
vi.mock("./tx", () => ({ withTenantTransaction }));

import type { Scope } from "./scope-sql";
import { platformOrgScope } from "../inbound/platform-scope";
import {
  claimPendingInboundEvents,
  insertInboundEvent,
  markInboundEventFailed,
  markInboundEventProcessed,
} from "./inbound-events";

const scope: Scope = { kind: "org", orgId: "platform-org-1" };
const client = { query };

const eventRow = {
  id: "evt-1",
  org_id: "platform-org-1",
  channel: "whatsapp" as const,
  external_id: "wamid.abc",
  payload: { from: "+919876543210" },
  status: "pending" as const,
  last_error: null,
  created_at: new Date("2026-08-13T07:00:00.000Z"),
  processed_at: null,
};

beforeEach(() => {
  query.mockReset();
  enqueueEvent.mockReset().mockResolvedValue("outbox-1");
  withCrossTenantRead.mockReset().mockImplementation(
    async (_actor: string, fn: (c: typeof client) => Promise<unknown>) => fn(client),
  );
  withTenantTransaction.mockReset().mockImplementation(
    async (_scope: unknown, fn: (c: typeof client) => Promise<unknown>) => fn(client),
  );
});

describe("platformOrgScope", () => {
  it("returns org scope from PLATFORM_ORG_ID", () => {
    expect(platformOrgScope({ PLATFORM_ORG_ID: "  org-uuid  " })).toEqual({
      kind: "org",
      orgId: "org-uuid",
    });
  });

  it("throws when PLATFORM_ORG_ID is missing", () => {
    expect(() => platformOrgScope({})).toThrow(/PLATFORM_ORG_ID is not set/);
  });
});

describe("insertInboundEvent", () => {
  it("inserts and enqueues inbound.message_received in the same transaction", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "evt-new" }] });

    const result = await insertInboundEvent(scope, client as never, {
      channel: "whatsapp",
      externalId: "wamid.abc",
      payload: { text: "hello" },
    });

    expect(result).toEqual({ id: "evt-new", inserted: true });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.inbound_events");
    expect(sql).toContain("ON CONFLICT (org_id, channel, external_id) DO NOTHING");
    expect(params).toEqual([
      "platform-org-1",
      "whatsapp",
      "wamid.abc",
      JSON.stringify({ text: "hello" }),
    ]);
    expect(enqueueEvent).toHaveBeenCalledWith(scope, client, {
      topic: "inbound.message_received",
      payload: { inboundEventId: "evt-new" },
    });
  });

  it("returns inserted false and skips enqueue on dedupe conflict", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const result = await insertInboundEvent(scope, client as never, {
      channel: "email",
      externalId: "msg-duplicate",
      payload: { MessageID: "msg-duplicate" },
    });

    expect(result).toEqual({ id: "", inserted: false });
    expect(enqueueEvent).not.toHaveBeenCalled();
  });

  it("refuses platform scope", async () => {
    await expect(
      insertInboundEvent(
        { kind: "platform", orgId: "platform-org-1" },
        client as never,
        { channel: "email", externalId: "x", payload: {} },
      ),
    ).rejects.toThrow(/platform scope cannot write/i);
  });
});

describe("claimPendingInboundEvents", () => {
  it("claims pending rows with FOR UPDATE SKIP LOCKED via cross-tenant read", async () => {
    query.mockResolvedValueOnce({ rows: [eventRow] });

    const events = await claimPendingInboundEvents(10);

    expect(withCrossTenantRead).toHaveBeenCalledWith("inbound-worker", expect.any(Function));
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("FROM adsagent.inbound_events");
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(params).toEqual([10]);
    expect(events).toHaveLength(1);
    expect(events[0].externalId).toBe("wamid.abc");
  });
});

describe("markInboundEventProcessed", () => {
  it("marks the event processed under tenant transaction", async () => {
    query.mockResolvedValue({ rows: [] });
    await markInboundEventProcessed(scope, "evt-1");
    expect(withTenantTransaction).toHaveBeenCalledWith(scope, expect.any(Function));
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("status = 'processed'");
    expect(sql).toContain("processed_at = now()");
    expect(sql).toContain("AND status = 'pending'");
    expect(params).toEqual(["evt-1"]);
  });
});

describe("markInboundEventFailed", () => {
  it("marks the event failed and stores the error", async () => {
    query.mockResolvedValue({ rows: [] });
    await markInboundEventFailed(scope, "evt-1", "media download failed");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("status = 'failed'");
    expect(sql).toContain("last_error = $2");
    expect(sql).toContain("AND status = 'pending'");
    expect(params).toEqual(["evt-1", "media download failed"]);
  });
});
