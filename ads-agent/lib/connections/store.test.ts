import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../db/tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) =>
    fn({ query }),
}));

import type { Scope } from "../db/scope-sql";
import { assertAccountAllowed, putConnection, type Connection } from "./store";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

const baseInput = {
  platform: "google" as const,
  externalAccountId: "1234567890",
  environment: "test" as const,
  credentialsSealed: Buffer.from("sealed-bytes"),
  canWrite: true,
  canActivate: false,
  allowlist: ["1234567890"],
  currency: "INR",
  timeZone: "Asia/Kolkata",
};

const connectionFixture = (): Connection => ({
  id: "conn-1",
  orgId: ORG.orgId,
  platform: "google",
  externalAccountId: "1234567890",
  environment: "test",
  credentialsSealed: Buffer.from("sealed-bytes"),
  canWrite: true,
  canActivate: false,
  allowlist: ["1234567890"],
  currency: "INR",
  timeZone: "Asia/Kolkata",
  status: "current",
  createdAt: "2026-11-01T00:00:00.000Z",
});

beforeEach(() => query.mockReset());

describe("putConnection", () => {
  it("rejects env:// credential pointers before any query", async () => {
    await expect(
      putConnection(ORG, {
        ...baseInput,
        credentialsSealed: "env://GOOGLE_ADS_REFRESH_TOKEN" as unknown as Buffer,
      }),
    ).rejects.toThrow(/env:\/\//);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("assertAccountAllowed", () => {
  it("returns outside_allowlist when the account is not listed", () => {
    const connection = connectionFixture();
    expect(assertAccountAllowed(connection, "9999999999")).toEqual({
      ok: false,
      reason: "outside_allowlist",
    });
  });

  it("returns ok when the account is on the allowlist", () => {
    const connection = connectionFixture();
    expect(assertAccountAllowed(connection, "1234567890")).toEqual({ ok: true });
  });
});
