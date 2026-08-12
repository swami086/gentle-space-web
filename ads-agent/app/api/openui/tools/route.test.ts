import { beforeEach, describe, expect, it, vi } from "vitest";

const scope = { kind: "platform" as const, orgId: "00000000-0000-0000-0000-000000000001" };

const mockProvider = {
  list_opportunities: vi.fn(),
  get_spend_cpl_trend: vi.fn(),
};

const { guard, createPlatformToolProvider } = vi.hoisted(() => ({
  guard: vi.fn(),
  createPlatformToolProvider: vi.fn(() => mockProvider),
}));

vi.mock("@/lib/auth/guard", () => ({ guard }));
vi.mock("@/lib/openui/platform-tools", () => ({ createPlatformToolProvider }));

import { POST } from "./route";

beforeEach(() => {
  guard.mockReset();
  createPlatformToolProvider.mockClear();
  mockProvider.list_opportunities.mockReset();
  mockProvider.get_spend_cpl_trend.mockReset();
  createPlatformToolProvider.mockReturnValue(mockProvider);
});

function req(body: unknown) {
  return new Request("http://localhost/api/openui/tools", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/openui/tools", () => {
  it("runs a registered tool for an authorized operator", async () => {
    guard.mockResolvedValue({ ok: true, session: {}, scope });
    mockProvider.list_opportunities.mockResolvedValue([{ id: "1" }]);

    const res = await POST(req({ name: "list_opportunities", args: {} }));

    expect(createPlatformToolProvider).toHaveBeenCalledWith(scope);
    expect(mockProvider.list_opportunities).toHaveBeenCalledWith({});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "1" }]);
  });

  it("returns the guard response when unauthorized", async () => {
    const forbidden = new Response(null, { status: 403 });
    guard.mockResolvedValue({ ok: false, response: forbidden });

    const res = await POST(req({ name: "list_opportunities", args: {} }));

    expect(res).toBe(forbidden);
    expect(mockProvider.list_opportunities).not.toHaveBeenCalled();
  });

  it("rejects an unknown tool name with 400", async () => {
    guard.mockResolvedValue({ ok: true, session: {}, scope });

    const res = await POST(req({ name: "not_a_tool", args: {} }));

    expect(res.status).toBe(400);
  });
});
