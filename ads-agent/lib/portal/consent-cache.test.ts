import { describe, it, expect, vi, beforeEach } from "vitest";

const loadConsentState = vi.fn();
vi.mock("./consent", () => ({ loadConsentState: (...a: unknown[]) => loadConsentState(...a) }));

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const scope = { kind: "org", orgId: ORG } as const;

beforeEach(async () => {
  loadConsentState.mockReset().mockResolvedValue({ purposes: ["space_recommendation"], latestAt: null });
  const { clearConsentCache } = await import("./consent-cache");
  clearConsentCache();
});

describe("getConsentStateCached", () => {
  it("hits the database once inside the TTL", async () => {
    const { getConsentStateCached } = await import("./consent-cache");
    await getConsentStateCached(scope, ORG, "sess-1", 1_000);
    await getConsentStateCached(scope, ORG, "sess-1", 1_500);
    expect(loadConsentState).toHaveBeenCalledTimes(1);
  });

  it("reloads after the TTL", async () => {
    const { getConsentStateCached, consentCacheTtlMs } = await import("./consent-cache");
    await getConsentStateCached(scope, ORG, "sess-1", 1_000);
    await getConsentStateCached(scope, ORG, "sess-1", 1_000 + consentCacheTtlMs() + 1);
    expect(loadConsentState).toHaveBeenCalledTimes(2);
  });

  it("reloads immediately after invalidation, TTL notwithstanding", async () => {
    const { getConsentStateCached, invalidateConsent, cacheKey } = await import("./consent-cache");
    await getConsentStateCached(scope, ORG, "sess-1", 1_000);
    invalidateConsent(cacheKey(ORG, "sess-1"));
    await getConsentStateCached(scope, ORG, "sess-1", 1_001);
    expect(loadConsentState).toHaveBeenCalledTimes(2);
  });

  it("keys separately per tenant, so one tenant cannot poison another's entry", async () => {
    const { getConsentStateCached } = await import("./consent-cache");
    await getConsentStateCached(scope, ORG, "sess-1", 1_000);
    await getConsentStateCached({ kind: "org", orgId: "bbbb" } as const, "bbbb", "sess-1", 1_000);
    expect(loadConsentState).toHaveBeenCalledTimes(2);
  });
});

describe("startConsentInvalidator", () => {
  it("drops the entry named by a consent_changed notification", async () => {
    const handlers: Array<(msg: { channel: string; payload?: string }) => void> = [];
    const client = {
      on: (_event: string, handler: (msg: { channel: string; payload?: string }) => void) => handlers.push(handler),
      removeAllListeners: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(client) };

    const { startConsentInvalidator, getConsentStateCached } = await import("./consent-cache");
    const stop = await startConsentInvalidator(pool as never);
    expect(client.query).toHaveBeenCalledWith("LISTEN consent_changed");

    await getConsentStateCached(scope, ORG, "sess-1", 1_000);
    handlers.forEach((h) => h({ channel: "consent_changed", payload: `${ORG}:sess-1` }));
    await getConsentStateCached(scope, ORG, "sess-1", 1_001);
    expect(loadConsentState).toHaveBeenCalledTimes(2);

    await stop();
    expect(client.release).toHaveBeenCalled();
  });
});
