import { describe, it, expect, vi, afterEach } from "vitest";
import { sendAlert } from "./alert";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ALERT_WEBHOOK_URL;
});

describe("sendAlert", () => {
  it("posts the signal and message to the webhook", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example/test";
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendAlert("cdc_lag", "cdc lag 1200s");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).text).toBe("[alert] cdc_lag: cdc lag 1200s");
  });

  it("never throws when the webhook is unreachable", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example/test";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(sendAlert("cdc_lag", "x")).resolves.toBeUndefined();
  });
});
