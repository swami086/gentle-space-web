import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));

const enqueueEvent = vi.fn().mockResolvedValue("outbox-1");
vi.mock("../db/outbox", () => ({ enqueueEvent: (...a: unknown[]) => enqueueEvent(...a) }));

// The real withTenantTransaction (S5a) is exercised by its own tests; here it is a
// pass-through so this suite tests the consent logic rather than transaction plumbing.
const clientQuery = vi.fn();
vi.mock("../db/tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: clientQuery }),
}));

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const scope = { kind: "org", orgId: ORG } as const;

beforeEach(() => {
  query.mockReset();
  clientQuery.mockReset().mockResolvedValue({ rows: [{ id: "consent-1" }] });
  enqueueEvent.mockClear();
});

describe("loadConsentState", () => {
  it("returns only purposes whose latest record is a grant", async () => {
    query.mockResolvedValueOnce({
      rows: [
        { purpose: "space_recommendation", latest_at: "2026-08-12T09:00:00.000Z" },
        { purpose: "site_analytics", latest_at: "2026-08-12T08:00:00.000Z" },
      ],
    });
    const { loadConsentState } = await import("./consent");
    const state = await loadConsentState(scope, "sess-1");
    expect(state.purposes.sort()).toEqual(["site_analytics", "space_recommendation"]);
    expect(state.latestAt).toBe("2026-08-12T09:00:00.000Z");
  });

  it("scopes the query by tenant and by subject", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { loadConsentState } = await import("./consent");
    await loadConsentState(scope, "sess-1");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("context.consent_records");
    expect(sql).toContain("subject_ref");
    expect(params).toContain(ORG);
    expect(params).toContain("sess-1");
  });

  it("returns an empty state when nothing was ever recorded, so the gate denies", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { loadConsentState } = await import("./consent");
    expect(await loadConsentState(scope, "unknown")).toEqual({ purposes: [], latestAt: null });
  });
});

describe("recordConsent", () => {
  it("inserts the grant through the shared transaction helper and publishes nothing", async () => {
    const { recordConsent } = await import("./consent");
    const id = await recordConsent(scope, {
      subjectRef: "sess-1", purposes: ["site_analytics"], action: "granted",
      noticeVersion: 1, mechanism: "banner",
    });
    expect(id).toBe("consent-1");
    expect(String(clientQuery.mock.calls[0][0])).toContain("context.consent_records");
    expect(enqueueEvent).not.toHaveBeenCalled();
  });

  it("raises deletion.requested through the outbox when consent is withdrawn", async () => {
    const { recordConsent } = await import("./consent");
    await recordConsent(scope, {
      subjectRef: "sess-1", purposes: ["space_recommendation"], action: "withdrawn",
      noticeVersion: 1, mechanism: "banner",
    });
    expect(enqueueEvent).toHaveBeenCalledTimes(1);
    const [passedScope, , event] = enqueueEvent.mock.calls[0];
    expect(passedScope).toEqual(scope);
    expect(event.topic).toBe("deletion.requested");
    expect(event.payload).toMatchObject({
      subject_kind: "enquirer", subject_ref: "sess-1", reason: "consent_withdrawn",
    });
  });

  it("invalidates the local cache immediately, without waiting for its own NOTIFY", async () => {
    const cache = await import("./consent-cache");
    const spy = vi.spyOn(cache, "invalidateConsent");
    const { recordConsent } = await import("./consent");
    await recordConsent(scope, {
      subjectRef: "sess-1", purposes: ["space_recommendation"], action: "withdrawn",
      noticeVersion: 1, mechanism: "banner",
    });
    expect(spy).toHaveBeenCalledWith(`${ORG}:sess-1`);
  });
});
