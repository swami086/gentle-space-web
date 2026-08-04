import { beforeEach, describe, expect, it, vi } from "vitest";

const { grantCredits } = vi.hoisted(() => ({
  grantCredits: vi.fn(),
}));

vi.mock("@/lib/metering/ledger", () => ({ grantCredits }));

import { POST } from "./route";

beforeEach(() => vi.clearAllMocks());

describe("POST /api/credits/grant", () => {
  it("grants credits for a valid request", async () => {
    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ orgId: "org-1", amountCredits: 100 }),
      }),
    );
    expect(grantCredits).toHaveBeenCalledWith({
      orgId: "org-1",
      userId: undefined,
      amountCredits: 100,
      grantedBy: "admin",
      note: undefined,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects a missing orgId", async () => {
    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ amountCredits: 100 }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "orgId is required" });
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("rejects non-positive amountCredits", async () => {
    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ orgId: "org-1", amountCredits: 0 }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "amountCredits must be a positive number" });
    expect(grantCredits).not.toHaveBeenCalled();
  });
});
