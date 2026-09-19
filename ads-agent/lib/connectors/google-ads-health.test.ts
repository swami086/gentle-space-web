import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listGoogleAdsTools = vi.fn();

vi.mock("../bifrost/google-ads-mcp-client", () => ({
  listGoogleAdsTools,
}));

import { probeGoogleAdsReadMcp } from "./google-ads-health";

const GOOGLE_ENV = {
  GOOGLE_ADS_DEVELOPER_TOKEN: "dev",
  GOOGLE_ADS_CLIENT_ID: "cid",
  GOOGLE_ADS_CLIENT_SECRET: "secret",
  GOOGLE_ADS_REFRESH_TOKEN: "refresh",
  GOOGLE_ADS_CUSTOMER_ID: "123",
} as const;

function setGoogleAdsEnv(configured: boolean): void {
  for (const key of Object.keys(GOOGLE_ENV) as (keyof typeof GOOGLE_ENV)[]) {
    if (configured) process.env[key] = GOOGLE_ENV[key];
    else delete process.env[key];
  }
}

describe("probeGoogleAdsReadMcp", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    listGoogleAdsTools.mockReset();
    setGoogleAdsEnv(true);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.useRealTimers();
  });

  it("reports configured false when Google Ads env is incomplete", async () => {
    setGoogleAdsEnv(false);

    const h = await probeGoogleAdsReadMcp();

    expect(h).toEqual({ configured: false, reachable: false });
    expect(listGoogleAdsTools).not.toHaveBeenCalled();
  });

  it("reachable true when listTools succeeds", async () => {
    listGoogleAdsTools.mockResolvedValue([{ name: "list_campaign_performance" }]);

    const h = await probeGoogleAdsReadMcp();

    expect(h).toEqual({ configured: true, reachable: true });
    expect(listGoogleAdsTools).toHaveBeenCalledTimes(1);
  });

  it("reachable false when listTools throws", async () => {
    listGoogleAdsTools.mockRejectedValue(new Error("boom"));

    const h = await probeGoogleAdsReadMcp({ timeoutMs: 50 });

    expect(h.configured).toBe(true);
    expect(h.reachable).toBe(false);
    expect(h.error).toBeTruthy();
    expect(h.error).toContain("boom");
  });

  it("reachable false when probe times out", async () => {
    vi.useFakeTimers();
    listGoogleAdsTools.mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      }),
    );

    const probe = probeGoogleAdsReadMcp({ timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    const h = await probe;

    expect(h.reachable).toBe(false);
    expect(h.error).toMatch(/timed out/i);
  });
});
