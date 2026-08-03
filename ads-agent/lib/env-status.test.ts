import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConnectorStatus } from "./env-status";

const ENV_KEYS = [
  "META_ACCESS_TOKEN",
  "META_AD_ACCOUNT_ID",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
  "TWENTY_API_KEY",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_APPLICATION_CREDENTIALS",
] as const;

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("getConnectorStatus", () => {
  it("reports everything unconfigured when no env vars are set", () => {
    expect(getConnectorStatus()).toEqual({
      meta: false,
      googleAds: false,
      twenty: false,
      vertexAi: false,
    });
  });

  it("reports meta configured only when both meta vars are set", () => {
    process.env.META_ACCESS_TOKEN = "token";
    expect(getConnectorStatus().meta).toBe(false);
    process.env.META_AD_ACCOUNT_ID = "12345";
    expect(getConnectorStatus().meta).toBe(true);
  });

  it("reports googleAds configured only when all five vars are set", () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
    process.env.GOOGLE_ADS_CLIENT_ID = "client-id";
    process.env.GOOGLE_ADS_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_ADS_REFRESH_TOKEN = "refresh-token";
    expect(getConnectorStatus().googleAds).toBe(false);
    process.env.GOOGLE_ADS_CUSTOMER_ID = "1234567890";
    expect(getConnectorStatus().googleAds).toBe(true);
  });

  it("reports twenty configured when TWENTY_API_KEY is set", () => {
    process.env.TWENTY_API_KEY = "key";
    expect(getConnectorStatus().twenty).toBe(true);
  });

  it("reports vertexAi configured only when both GCP vars are set", () => {
    process.env.GOOGLE_CLOUD_PROJECT = "propane-galaxy-498403-n8";
    expect(getConnectorStatus().vertexAi).toBe(false);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/path/to/key.json";
    expect(getConnectorStatus().vertexAi).toBe(true);
  });

  it("treats a blank/whitespace-only value as unconfigured", () => {
    process.env.TWENTY_API_KEY = "   ";
    expect(getConnectorStatus().twenty).toBe(false);
  });

  it("never includes the actual secret values in its return object", () => {
    process.env.META_ACCESS_TOKEN = "super-secret-token";
    process.env.META_AD_ACCOUNT_ID = "12345";
    const result = getConnectorStatus();
    expect(JSON.stringify(result)).not.toContain("super-secret-token");
  });
});
