import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import { findOrCreateUserByGoogle, findUserById, touchLastLogin } from "./users";

beforeEach(() => query.mockReset());

describe("findOrCreateUserByGoogle", () => {
  it("returns the existing user when google_sub already exists", async () => {
    query.mockResolvedValue({
      rows: [{ id: "u-1", email: "a@x.com", name: "A", avatar_url: null }],
    });
    const user = await findOrCreateUserByGoogle({
      googleSub: "g-1",
      email: "a@x.com",
      name: "A",
      avatarUrl: null,
    });
    expect(user).toEqual({ id: "u-1", email: "a@x.com", name: "A", avatarUrl: null });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO users"), [
      "g-1",
      "a@x.com",
      "A",
      null,
    ]);
  });
});

describe("findUserById", () => {
  it("returns null when no user exists", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(findUserById("missing")).resolves.toBeNull();
  });

  it("returns the mapped user when found", async () => {
    query.mockResolvedValue({
      rows: [{ id: "u-1", email: "a@x.com", name: null, avatar_url: null }],
    });
    await expect(findUserById("u-1")).resolves.toEqual({
      id: "u-1",
      email: "a@x.com",
      name: null,
      avatarUrl: null,
    });
  });
});

describe("touchLastLogin", () => {
  it("updates last_login_at for the given user", async () => {
    query.mockResolvedValue({ rows: [] });
    await touchLastLogin("u-1");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE users"), ["u-1"]);
  });
});
