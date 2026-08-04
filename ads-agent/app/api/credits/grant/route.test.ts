import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { grantCredits, requireApiRole } = vi.hoisted(() => ({
  grantCredits: vi.fn(),
  requireApiRole: vi.fn(),
}));

vi.mock("@/lib/metering/ledger", () => ({ grantCredits }));
vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));

import { POST } from "./route";

function req(body: unknown): Request {
  return new Request("http://localhost:3030/api/credits/grant", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  grantCredits.mockReset();
  requireApiRole.mockReset();
  requireApiRole.mockResolvedValue({
    ok: true,
    session: { orgId: "org-1", email: "admin@x.com", userId: "u-1", role: "admin" },
  });
});

describe("POST /api/credits/grant", () => {
  it("passes through the 401/403 response when requireApiRole rejects the caller", async () => {
    requireApiRole.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await POST(req({ amountCredits: 100 }));
    expect(res.status).toBe(403);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("rejects a non-positive amountCredits", async () => {
    const res = await POST(req({ amountCredits: 0 }));
    expect(res.status).toBe(400);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("grants credits to the session's orgId, ignoring any client-submitted orgId", async () => {
    const res = await POST(req({ orgId: "attacker-org", amountCredits: 100, note: "top-up" }));
    expect(res.status).toBe(200);
    expect(grantCredits).toHaveBeenCalledWith({
      orgId: "org-1",
      userId: undefined,
      amountCredits: 100,
      grantedBy: "admin@x.com",
      note: "top-up",
    });
  });
});
