import { beforeEach, describe, expect, it, vi } from "vitest";

const poolQuery = vi.fn();
const clientQuery = vi.fn();
const release = vi.fn();
const connect = vi.fn().mockResolvedValue({ query: clientQuery, release });
vi.mock("../db/client", () => ({ getPool: () => ({ query: poolQuery, connect }) }));

import { getOrgBalance, getUserCap, grantCredits, debitUsage } from "./ledger";
import { InsufficientCreditsError } from "./types";

beforeEach(() => {
  poolQuery.mockReset();
  clientQuery.mockReset();
  release.mockReset();
  connect.mockClear();
  clientQuery.mockResolvedValue({ rows: [] });
});

describe("getOrgBalance", () => {
  it("returns 0 when the org has no balance row", async () => {
    poolQuery.mockResolvedValue({ rows: [] });
    await expect(getOrgBalance("org-1")).resolves.toBe(0);
  });

  it("returns the numeric balance when a row exists", async () => {
    poolQuery.mockResolvedValue({ rows: [{ balance_credits: "42.5" }] });
    await expect(getOrgBalance("org-1")).resolves.toBe(42.5);
  });
});

describe("getUserCap", () => {
  it("returns null when the user has no individual cap configured", async () => {
    poolQuery.mockResolvedValue({ rows: [] });
    await expect(getUserCap("user-1")).resolves.toBeNull();
  });

  it("returns the numeric cap when a row exists", async () => {
    poolQuery.mockResolvedValue({ rows: [{ balance_credits: "10" }] });
    await expect(getUserCap("user-1")).resolves.toBe(10);
  });
});

describe("grantCredits", () => {
  it("inserts a grant row and credits the org pool when no userId is given", async () => {
    await grantCredits({ orgId: "org-1", amountCredits: 100, grantedBy: "admin@x.com" });
    expect(clientQuery).toHaveBeenCalledWith("BEGIN");
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO credit_grants"), [
      "org-1",
      null,
      100,
      "admin@x.com",
      null,
    ]);
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE org_balances"), [
      "org-1",
      100,
    ]);
    expect(clientQuery).toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("upserts user_balances when a userId is given", async () => {
    await grantCredits({ orgId: "org-1", userId: "user-1", amountCredits: 50, grantedBy: "admin@x.com" });
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO user_balances"),
      ["user-1", "org-1", 50],
    );
  });

  it("rolls back and rethrows on failure", async () => {
    clientQuery.mockImplementation((sql: string) => {
      if (sql.startsWith("INSERT INTO credit_grants")) throw new Error("db exploded");
      return Promise.resolve({ rows: [] });
    });
    await expect(
      grantCredits({ orgId: "org-1", amountCredits: 10, grantedBy: "x" }),
    ).rejects.toThrow("db exploded");
    expect(clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("debitUsage", () => {
  const baseInput = {
    orgId: "org-1",
    userId: "user-1",
    feature: "ads-agent:campaign-chat",
    provider: "vertex",
    model: "gemini-2.5-flash-lite",
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    costUsd: 0.001,
    creditsDebited: 0.1,
    requestId: "req-1",
  };

  it("locks org_balances FOR UPDATE, debits it, and inserts a usage_ledger row", async () => {
    clientQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM org_balances")) return Promise.resolve({ rows: [{ balance_credits: "5" }] });
      if (sql.includes("FROM user_balances")) return Promise.resolve({ rows: [] }); // no individual cap
      return Promise.resolve({ rows: [] });
    });

    await debitUsage(baseInput);

    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), ["org-1"]);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE org_balances"),
      ["org-1", 0.1],
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO usage_ledger"),
      expect.arrayContaining(["org-1", "user-1", "ads-agent:campaign-chat"]),
    );
    expect(clientQuery).toHaveBeenCalledWith("COMMIT");
  });

  it("also debits user_balances when an individual cap row exists", async () => {
    clientQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM org_balances")) return Promise.resolve({ rows: [{ balance_credits: "5" }] });
      if (sql.includes("FROM user_balances")) return Promise.resolve({ rows: [{ balance_credits: "2" }] });
      return Promise.resolve({ rows: [] });
    });

    await debitUsage(baseInput);

    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE user_balances"),
      ["user-1", 0.1],
    );
  });

  it("throws InsufficientCreditsError when the org has no balance row at all", async () => {
    clientQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM org_balances")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    await expect(debitUsage(baseInput)).rejects.toThrow(InsufficientCreditsError);
    expect(clientQuery).toHaveBeenCalledWith("ROLLBACK");
  });

  it("wraps a CHECK-constraint violation as InsufficientCreditsError and rolls back", async () => {
    clientQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM org_balances")) return Promise.resolve({ rows: [{ balance_credits: "0.01" }] });
      if (sql.includes("FROM user_balances")) return Promise.resolve({ rows: [] });
      if (sql.startsWith("UPDATE org_balances")) throw new Error('new row for relation "org_balances" violates check constraint "org_balances_balance_credits_check"');
      return Promise.resolve({ rows: [] });
    });

    await expect(debitUsage(baseInput)).rejects.toThrow(InsufficientCreditsError);
    expect(clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
