import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listOrgMembers, assignRole } from "./internal-client";

const originalFetch = global.fetch;

beforeEach(() => {
  process.env.AUTH_SERVICE_URL = "http://localhost:3040";
  process.env.AUTH_SERVICE_INTERNAL_API_KEY = "test-key";
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("listOrgMembers", () => {
  it("GETs /internal/org-members with the internal api key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ members: [], pending: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await listOrgMembers();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3040/internal/org-members",
      expect.objectContaining({ headers: { "x-internal-api-key": "test-key" } }),
    );
    expect(result).toEqual({ members: [], pending: [] });
  });

  it("throws when the response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
    await expect(listOrgMembers()).rejects.toThrow(/401/);
  });
});

describe("assignRole", () => {
  it("POSTs userId + role with the internal api key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await assignRole("u-1", "operator");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3040/internal/org-members",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-api-key": "test-key" },
        body: JSON.stringify({ userId: "u-1", role: "operator" }),
      }),
    );
  });

  it("throws when the response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 }) as unknown as typeof fetch;
    await expect(assignRole("u-1", "admin")).rejects.toThrow(/400/);
  });
});
