import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));

const enqueueEvent = vi.fn().mockResolvedValue("outbox-1");
vi.mock("../db/outbox", () => ({ enqueueEvent: (...a: unknown[]) => enqueueEvent(...a) }));

const clientQuery = vi.fn();
vi.mock("../db/tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: clientQuery }),
}));

const getConsentStateCached = vi.fn();
vi.mock("./consent-cache", () => ({
  getConsentStateCached: (...a: unknown[]) => getConsentStateCached(...a),
  ensureConsentInvalidator: vi.fn().mockResolvedValue(undefined),
  cacheKey: (o: string, s: string) => `${o}:${s}`,
  invalidateConsent: vi.fn(),
}));

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    taxonomy_version: 1,
    session_id: "abcdefabcdefabcdef01",
    events: [{ event: "listing_view", occurred_at: "2026-08-12T09:00:00.000Z", payload: { listing_ref: "l-1", dwell_seconds: 5 } }],
    ...overrides,
  });
}

beforeEach(async () => {
  query.mockReset().mockResolvedValue({
    rows: [{
      org_id: ORG,
      allowed_origins: ["https://broker.example"],
      purposes_offered: ["space_recommendation", "site_analytics"],
      notice_version: 1,
    }],
  });
  clientQuery.mockReset().mockResolvedValue({ rows: [] });
  enqueueEvent.mockClear();
  getConsentStateCached.mockReset().mockResolvedValue({ purposes: ["space_recommendation"], latestAt: null });
  const { resetRateLimits } = await import("./rate-limit");
  resetRateLimits();
  const { clearPortalConfigCache } = await import("./config");
  clearPortalConfigCache();
});

describe("ingest", () => {
  const good = { body: body(), ingestKey: "pk_live_broker", origin: "https://broker.example" };

  it("accepts a consented event and publishes it through the outbox", async () => {
    const { ingest } = await import("./ingest");
    const outcome = await ingest(good);
    expect(outcome).toMatchObject({ ok: true, accepted: 1 });
    expect(enqueueEvent).toHaveBeenCalledTimes(1);
    const [passedScope, , event] = enqueueEvent.mock.calls[0];
    expect(passedScope).toEqual({ kind: "org", orgId: ORG });
    expect(event.topic).toBe("portal.event");
    expect(event.payload).toMatchObject({
      org_id: ORG,
      event: "listing_view",
      purpose: "space_recommendation",
      session_id: "abcdefabcdefabcdef01",
      taxonomy_version: 1,
    });
  });

  it("rejects an unknown ingest key with 404, never 403", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { ingest } = await import("./ingest");
    expect(await ingest({ ...good, ingestKey: "pk_nope" })).toEqual({ ok: false, status: 404, reason: "unknown_key" });
  });

  it("rejects an origin the broker never registered", async () => {
    const { ingest } = await import("./ingest");
    expect(await ingest({ ...good, origin: "https://evil.example" })).toEqual({
      ok: false, status: 403, reason: "origin_not_allowed",
    });
  });

  it("rejects an event with no consent at all, and stores nothing", async () => {
    getConsentStateCached.mockResolvedValue({ purposes: [], latestAt: null });
    const { ingest } = await import("./ingest");
    expect(await ingest(good)).toEqual({ ok: false, status: 403, reason: "no_consent" });
    expect(enqueueEvent).not.toHaveBeenCalled();
  });

  it("rejects an event whose purpose is not the one consented to", async () => {
    getConsentStateCached.mockResolvedValue({ purposes: ["site_analytics"], latestAt: null });
    const { ingest } = await import("./ingest");
    expect(await ingest(good)).toEqual({ ok: false, status: 403, reason: "no_consent" });
    expect(enqueueEvent).not.toHaveBeenCalled();
  });

  it("rejects an event whose purpose the broker does not even offer", async () => {
    query.mockResolvedValue({
      rows: [{ org_id: ORG, allowed_origins: ["https://broker.example"], purposes_offered: ["site_analytics"], notice_version: 1 }],
    });
    getConsentStateCached.mockResolvedValue({ purposes: ["space_recommendation"], latestAt: null });
    const { ingest } = await import("./ingest");
    expect(await ingest(good)).toEqual({ ok: false, status: 403, reason: "no_consent" });
  });

  it("rejects a body over the size cap before parsing it", async () => {
    const { ingest } = await import("./ingest");
    const outcome = await ingest({ ...good, body: "x".repeat(9000) });
    expect(outcome).toEqual({ ok: false, status: 413, reason: "too_large" });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects malformed json and an unknown event shape", async () => {
    const { ingest } = await import("./ingest");
    expect(await ingest({ ...good, body: "{not json" })).toEqual({ ok: false, status: 400, reason: "invalid_json" });
    expect(
      await ingest({ ...good, body: body({ events: [{ event: "scroll", occurred_at: "2026-08-12T09:00:00.000Z", payload: {} }] }) }),
    ).toEqual({ ok: false, status: 400, reason: "invalid_shape" });
  });

  it("rate limits before touching the database", async () => {
    const { ingest } = await import("./ingest");
    const { SESSION_LIMIT_PER_MINUTE } = await import("./rate-limit");
    for (let i = 0; i < SESSION_LIMIT_PER_MINUTE; i += 1) await ingest(good);
    const calls = query.mock.calls.length;
    expect(await ingest(good)).toEqual({ ok: false, status: 429, reason: "rate_limited" });
    expect(query.mock.calls.length).toBe(calls);
  });

  it("publishes only the consented events from a mixed batch", async () => {
    const { ingest } = await import("./ingest");
    const mixed = body({
      events: [
        { event: "listing_view", occurred_at: "2026-08-12T09:00:00.000Z", payload: { listing_ref: "l-1", dwell_seconds: 5 } },
        { event: "contact_revealed", occurred_at: "2026-08-12T09:00:01.000Z", payload: { listing_ref: "l-1", channel: "phone" } },
      ],
    });
    const outcome = await ingest({ ...good, body: mixed });
    expect(outcome).toMatchObject({ ok: true, accepted: 1 });
    expect(enqueueEvent).toHaveBeenCalledTimes(1);
  });
});

describe("resolveIngestKey", () => {
  it("throws on org scope, because the lookup is inherently cross-tenant", async () => {
    const { resolveIngestKey } = await import("./config");
    await expect(resolveIngestKey({ kind: "org", orgId: ORG }, "pk")).rejects.toThrow("platform scope");
  });
});
