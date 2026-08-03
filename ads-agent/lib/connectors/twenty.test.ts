import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("fetchLeadSignal", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, TWENTY_BASE_URL: "http://localhost:3020", TWENTY_API_KEY: "k" };
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("counts opportunities by tier", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            opportunities: [
              { tier: "HOT" },
              { tier: "HOT" },
              { tier: "WARM" },
              { tier: "COLD" },
              { tier: "UNSCORED" },
              { tier: null },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchLeadSignal } = await import("./twenty");
    await expect(fetchLeadSignal()).resolves.toEqual({
      hotCount: 2,
      warmCount: 1,
      coldCount: 1,
      unscoredCount: 2,
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/rest/opportunities");
    expect(fetchMock.mock.calls[0][1]?.headers?.Authorization).toBe("Bearer k");
  });

  it("returns all zeros when TWENTY_API_KEY is unset", async () => {
    delete process.env.TWENTY_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { fetchLeadSignal } = await import("./twenty");
    await expect(fetchLeadSignal()).resolves.toEqual({
      hotCount: 0,
      warmCount: 0,
      coldCount: 0,
      unscoredCount: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns all zeros when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    const { fetchLeadSignal } = await import("./twenty");
    await expect(fetchLeadSignal()).resolves.toEqual({
      hotCount: 0,
      warmCount: 0,
      coldCount: 0,
      unscoredCount: 0,
    });
  });
});
