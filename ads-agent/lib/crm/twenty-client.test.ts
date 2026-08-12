import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getTwentyConnection } = vi.hoisted(() => ({
  getTwentyConnection: vi.fn(),
}));
vi.mock("../db/twenty-connections", () => ({ getTwentyConnection }));
vi.mock("./twenty-secrets", () => ({ resolveTwentyApiKey: async () => "test-key" }));

import { getTwentyClient } from "./twenty-client";

const active = {
  orgId: "org-1",
  baseUrl: "https://crm-org-1.gentlespace.in",
  apiKeyRef: "env://TWENTY_API_KEY",
  coolifyServiceUuid: "svc-abc",
  twentyVersion: "1.9.0",
  state: "active" as const,
  provisionedAt: "2026-08-12T00:00:00.000Z",
  lastSyncAt: null,
  lastError: null,
};

beforeEach(() => {
  getTwentyConnection.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getTwentyClient", () => {
  it("throws when the org has no instance, rather than returning an empty client", async () => {
    getTwentyConnection.mockResolvedValue(null);
    await expect(getTwentyClient("org-2")).rejects.toThrow(/no Twenty connection/i);
  });

  it("throws when the instance is suspended", async () => {
    getTwentyConnection.mockResolvedValue({ ...active, state: "suspended" });
    await expect(getTwentyClient("org-1")).rejects.toThrow(/state suspended/i);
  });

  it("no longer special-cases the shared instance, because no org points at it", async () => {
    getTwentyConnection.mockResolvedValue({ ...active, baseUrl: "https://crm.gentlespace.in" });
    const client = await getTwentyClient("org-1");
    expect(client.orgId).toBe("org-1");
  });

  it("still refuses any org without its own active connection, which is the stronger guard", async () => {
    getTwentyConnection.mockResolvedValue(null);
    await expect(getTwentyClient("org-2")).rejects.toThrow(/no Twenty connection/i);
    getTwentyConnection.mockResolvedValue({ ...active, state: "deprovisioned" });
    await expect(getTwentyClient("org-1")).rejects.toThrow(/state deprovisioned/i);
  });

  it("binds requests to that org's base url and key", async () => {
    getTwentyConnection.mockResolvedValue(active);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { id: "person-9" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = await getTwentyClient("org-1");
    const person = await client.upsertPerson({ firstName: "Asha", lastName: "Rao", phone: "+919800000000" });

    expect(person.id).toBe("person-9");
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("https://crm-org-1.gentlespace.in/rest/people");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("surfaces a Twenty error as a throw, so a caller cannot mistake it for empty data", async () => {
    getTwentyConnection.mockResolvedValue(active);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream boom", { status: 502 })),
    );
    const client = await getTwentyClient("org-1");
    await expect(client.getOpportunity("opp-1")).rejects.toThrow(/502/);
  });
});
