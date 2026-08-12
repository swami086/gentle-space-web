import { beforeEach, describe, expect, it, vi } from "vitest";

const scope = { kind: "platform" as const, orgId: "00000000-0000-0000-0000-000000000001" };

const { guard, platformToolProvider } = vi.hoisted(() => ({
  guard: vi.fn(),
  platformToolProvider: {
    list_opportunities: vi.fn(),
    get_spend_cpl_trend: vi.fn(),
  } as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("@/lib/auth/guard", () => ({ guard }));
vi.mock("@/lib/openui/platform-tools", () => ({ platformToolProvider }));

import { POST } from "./route";

beforeEach(() => {
  guard.mockReset();
  platformToolProvider.list_opportunities.mockReset();
  platformToolProvider.get_spend_cpl_trend.mockReset();
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
    platformToolProvider.list_opportunities.mockResolvedValue([{ id: "1" }]);

    const res = await POST(req({ name: "list_opportunities", args: {} }));

    expect(platformToolProvider.list_opportunities).toHaveBeenCalledWith({});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "1" }]);
  });

  it("returns the guard response when unauthorized", async () => {
    const forbidden = new Response(null, { status: 403 });
    guard.mockResolvedValue({ ok: false, response: forbidden });

    const res = await POST(req({ name: "list_opportunities", args: {} }));

    expect(res).toBe(forbidden);
    expect(platformToolProvider.list_opportunities).not.toHaveBeenCalled();
  });

  it("rejects an unknown tool name with 400", async () => {
    guard.mockResolvedValue({ ok: true, session: {}, scope });

    const res = await POST(req({ name: "not_a_tool", args: {} }));

    expect(res.status).toBe(400);
  });
});
