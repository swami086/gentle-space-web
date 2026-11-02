import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateUnifiedCampaign,
  createPausedUnifiedCampaign,
  resetUnifiedConnectionModesForTest,
  updateUnifiedCampaignBudget,
} from "./unified-sandbox";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.UNIFIED_API_KEY;
  resetUnifiedConnectionModesForTest();
});

beforeEach(() => {
  resetUnifiedConnectionModesForTest();
});

describe("createPausedUnifiedCampaign", () => {
  it("refuses test mode when the connection read is not Sandbox and does not create", async () => {
    process.env.UNIFIED_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ environment: "Production", id: "prod-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createPausedUnifiedCampaign({
        connectionId: "prod-1",
        name: "stage0",
        budgetAmount: 100,
        budgetPeriod: "TOTAL",
      }),
    ).rejects.toThrow("not Sandbox");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses production mode when the connection read is Sandbox", async () => {
    process.env.UNIFIED_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ environment: "Sandbox", id: "sandbox-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createPausedUnifiedCampaign(
        {
          connectionId: "sandbox-1",
          name: "live",
          budgetAmount: 100,
          budgetPeriod: "TOTAL",
        },
        "production",
      ),
    ).rejects.toThrow("Sandbox, not production");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the same connection id is used for both modes", async () => {
    process.env.UNIFIED_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ environment: "Sandbox" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "camp-1", status: "PAUSED" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ status: "PAUSED" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ environment: "Production" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await createPausedUnifiedCampaign(
      {
        connectionId: "conn-1",
        name: "test share",
        budgetAmount: 100,
        budgetPeriod: "TOTAL",
      },
      "test",
    );

    await expect(
      createPausedUnifiedCampaign(
        {
          connectionId: "conn-1",
          name: "prod share",
          budgetAmount: 100,
          budgetPeriod: "TOTAL",
        },
        "production",
      ),
    ).rejects.toThrow("cannot be used for both test and production");
  });

  it("creates a paused campaign only after the connection reads as Sandbox and GET readback is PAUSED", async () => {
    process.env.UNIFIED_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ environment: "Sandbox", id: "sandbox-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "camp-1", status: "PAUSED" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "camp-1", status: "PAUSED" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const id = await createPausedUnifiedCampaign({
      connectionId: "sandbox-1",
      name: "stage0-paused-share",
      budgetAmount: 200,
      budgetPeriod: "TOTAL",
      advertisingChannelType: "SEARCH",
    });

    expect(id).toBe("camp-1");
    const createCall = fetchMock.mock.calls[1];
    expect(String(createCall?.[0])).toBe("https://api.unified.to/ads/sandbox-1/campaign");
    expect(JSON.parse(String(createCall?.[1].body))).toMatchObject({
      status: "PAUSED",
      budget_period: "TOTAL",
      budget_amount: 200,
    });
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/campaign/camp-1");
  });

  it("throws when the post-create GET status is not PAUSED", async () => {
    process.env.UNIFIED_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ environment: "Sandbox" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "camp-1", status: "PAUSED" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "camp-1", status: "ACTIVE" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createPausedUnifiedCampaign({
        connectionId: "sandbox-1",
        name: "bad readback",
        budgetAmount: 100,
        budgetPeriod: "TOTAL",
      }),
    ).rejects.toThrow("readback was not paused");
  });

  it("keeps the budget period when the amount changes", async () => {
    process.env.UNIFIED_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ environment: "Sandbox" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ budget_period: "TOTAL" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ budget_amount: 1500, budget_period: "TOTAL" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await updateUnifiedCampaignBudget("sandbox-1", "camp-1", 1500);

    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1].body))).toEqual({
      budget_amount: 1500,
      budget_period: "TOTAL",
    });
  });
});

describe("activateUnifiedCampaign", () => {
  it("does not PUT when canActivate is false", async () => {
    process.env.UNIFIED_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ environment: "Production" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      activateUnifiedCampaign("prod-conn", "camp-1", { canActivate: false, mode: "production" }),
    ).rejects.toThrow("activation is not allowed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const putCalls = fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT");
    expect(putCalls).toHaveLength(0);
  });

  it("does not PUT when mode is test", async () => {
    process.env.UNIFIED_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ environment: "Production" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      activateUnifiedCampaign("prod-conn", "camp-1", { canActivate: true, mode: "test" }),
    ).rejects.toThrow("activation is not allowed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const putCalls = fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT");
    expect(putCalls).toHaveLength(0);
  });

  it("PUTs ACTIVE only for production when canActivate is true and connection is not Sandbox", async () => {
    process.env.UNIFIED_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ environment: "Production" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ environment: "Production" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ status: "ACTIVE" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await activateUnifiedCampaign("prod-conn", "camp-1", { canActivate: true, mode: "production" });

    const putCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT");
    expect(putCall).toBeDefined();
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({ status: "ACTIVE" });
  });
});
