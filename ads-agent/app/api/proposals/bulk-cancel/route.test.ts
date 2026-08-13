import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const TEST_SCOPE = { kind: "org" as const, orgId: "org-1" };
const BATCH_ID = "11111111-1111-1111-1111-111111111111";

const { cancelScheduledBatch, guard } = vi.hoisted(() => ({
  cancelScheduledBatch: vi.fn(),
  guard: vi.fn(),
}));

vi.mock("@/lib/db/proposals", () => ({ cancelScheduledBatch }));
vi.mock("@/lib/auth/guard", () => ({ guard }));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/proposals/bulk-cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({
    ok: true,
    session: { userId: "u-1", email: "a@b.com", orgId: "org-1", role: "operator" },
    scope: TEST_SCOPE,
  });
});

describe("POST /api/proposals/bulk-cancel", () => {
  it("returns guard response when unauthenticated", async () => {
    guard.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await post({ batchId: BATCH_ID });
    expect(res.status).toBe(401);
  });

  it("returns 400 for a missing batchId", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "batchId must be a string" });
  });

  it("returns 400 for an invalid batchId", async () => {
    const res = await post({ batchId: "not-a-uuid" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid batchId" });
  });

  it("normalizes uppercase batchId and cancels the batch", async () => {
    cancelScheduledBatch.mockResolvedValue(3);

    const res = await post({ batchId: BATCH_ID.toUpperCase() });

    expect(cancelScheduledBatch).toHaveBeenCalledWith(TEST_SCOPE, BATCH_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ canceled: 3 });
  });
});
