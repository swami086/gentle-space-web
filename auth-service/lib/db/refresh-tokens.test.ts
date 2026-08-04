import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import { createRefreshToken, rotateRefreshToken, revokeRefreshToken } from "./refresh-tokens";

beforeEach(() => query.mockReset());

describe("createRefreshToken", () => {
  it("inserts a hashed token and returns the raw token", async () => {
    query.mockResolvedValue({ rows: [] });
    const raw = await createRefreshToken("u-1");
    expect(typeof raw).toBe("string");
    expect(raw.length).toBeGreaterThan(20);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO refresh_tokens"),
      expect.arrayContaining(["u-1"]),
    );
  });
});

describe("rotateRefreshToken", () => {
  it("returns null when the token doesn't match any row", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(rotateRefreshToken("bogus")).resolves.toBeNull();
  });

  it("returns null when the matching row is expired", async () => {
    query.mockResolvedValue({
      rows: [{ id: "rt-1", user_id: "u-1", expires_at: new Date(Date.now() - 1000), revoked_at: null }],
    });
    await expect(rotateRefreshToken("raw-token")).resolves.toBeNull();
  });

  it("returns null when the matching row was already revoked", async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: "rt-1",
          user_id: "u-1",
          expires_at: new Date(Date.now() + 100000),
          revoked_at: new Date(),
        },
      ],
    });
    await expect(rotateRefreshToken("raw-token")).resolves.toBeNull();
  });

  it("revokes the old token and issues a new one when valid", async () => {
    query.mockImplementation((sql: unknown) => {
      const text = typeof sql === "string" ? sql : "";
      if (text.includes("SELECT") && text.includes("FROM refresh_tokens")) {
        return Promise.resolve({
          rows: [
            {
              id: "rt-1",
              user_id: "u-1",
              expires_at: new Date(Date.now() + 100000),
              revoked_at: null,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const result = await rotateRefreshToken("raw-token");
    expect(result?.userId).toBe("u-1");
    expect(typeof result?.newRawToken).toBe("string");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE refresh_tokens"), ["rt-1"]);
  });
});

describe("revokeRefreshToken", () => {
  it("marks the matching token revoked", async () => {
    query.mockResolvedValue({ rows: [] });
    await revokeRefreshToken("raw-token");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE refresh_tokens"), [
      expect.any(String),
    ]);
  });
});
