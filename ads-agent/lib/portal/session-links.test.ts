import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const ENQUIRY = "eeeeeeee-0000-4000-8000-00000000000e";
const scope = { kind: "org", orgId: ORG } as const;

beforeEach(() => query.mockReset());

describe("linkSession", () => {
  it("records the link idempotently, because the event can be delivered twice", async () => {
    query.mockResolvedValue({ rows: [] });
    const { linkSession } = await import("./session-links");
    await linkSession(scope, { sessionId: "sess-1", enquiryId: ENQUIRY });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("context.session_links");
    expect(sql).toContain("ON CONFLICT");
    expect(params).toEqual([ORG, "sess-1", ENQUIRY]);
  });
});

describe("erasureSubjects", () => {
  it("expands an enquiry into the enquiry and every session linked to it", async () => {
    query.mockResolvedValueOnce({ rows: [{ session_id: "sess-1" }, { session_id: "sess-2" }] });
    const { erasureSubjects } = await import("./session-links");
    expect(await erasureSubjects(scope, ENQUIRY)).toEqual({
      enquiryIds: [ENQUIRY],
      sessionIds: ["sess-1", "sess-2"],
    });
  });

  it("expands a session into the session and every enquiry it was linked to", async () => {
    query.mockResolvedValueOnce({ rows: [{ enquiry_id: ENQUIRY }] });
    const { erasureSubjects } = await import("./session-links");
    expect(await erasureSubjects(scope, "sess-1")).toEqual({
      enquiryIds: [ENQUIRY],
      sessionIds: ["sess-1"],
    });
  });

  it("returns the subject alone when nothing is linked, never an empty set", async () => {
    query.mockResolvedValue({ rows: [] });
    const { erasureSubjects } = await import("./session-links");
    expect(await erasureSubjects(scope, "sess-lonely")).toEqual({
      enquiryIds: [],
      sessionIds: ["sess-lonely"],
    });
  });
});

describe("unlinkedSessionsOlderThan", () => {
  it("asks only for sessions with no link row, because pseudonymous is not exempt", async () => {
    query.mockResolvedValue({ rows: [{ session_id: "sess-old" }] });
    const { unlinkedSessionsOlderThan } = await import("./session-links");
    expect(await unlinkedSessionsOlderThan(scope, 90)).toEqual(["sess-old"]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("context.session_links");
    expect(params).toContain(90);
  });
});

describe("ingest links a submitted enquiry to its session", () => {
  it("writes the link in the same transaction as the publish", async () => {
    vi.resetModules();
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock("../db/client", () => ({
      getPool: () => ({
        query: vi.fn().mockResolvedValue({
          rows: [{
            org_id: ORG,
            allowed_origins: ["https://broker.example"],
            purposes_offered: ["enquiry_handling"],
            notice_version: 1,
          }],
        }),
      }),
    }));
    vi.doMock("../db/tx", () => ({
      withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
        fn({ query: clientQuery }),
    }));
    vi.doMock("../db/outbox", () => ({ enqueueEvent: vi.fn().mockResolvedValue("outbox-1") }));
    vi.doMock("./consent-cache", () => ({
      getConsentStateCached: vi.fn().mockResolvedValue({ purposes: ["enquiry_handling"], latestAt: null }),
      ensureConsentInvalidator: vi.fn().mockResolvedValue(undefined),
      cacheKey: (o: string, s: string) => `${o}:${s}`,
      invalidateConsent: vi.fn(),
    }));

    const { ingest } = await import("./ingest");
    const outcome = await ingest({
      ingestKey: "pk_live_broker",
      origin: "https://broker.example",
      body: JSON.stringify({
        taxonomy_version: 1,
        session_id: "abcdefabcdefabcdef01",
        events: [{ event: "enquiry_submitted", occurred_at: "2026-08-12T09:00:00.000Z", payload: { enquiry_ref: ENQUIRY } }],
      }),
    });

    expect(outcome).toMatchObject({ ok: true, accepted: 1 });
    const statements = clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((s) => s.includes("context.session_links"))).toBe(true);
    expect(statements.some((s) => s.includes("ON CONFLICT"))).toBe(true);
  });
});
