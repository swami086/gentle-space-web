import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import {
  getMembership,
  upsertMembership,
  listMembers,
  listPendingUsers,
  INTERNAL_ORG_ID,
} from "./org-members";

beforeEach(() => query.mockReset());

describe("getMembership", () => {
  it("returns null when the user has no membership yet (pending)", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getMembership("u-1")).resolves.toBeNull();
  });

  it("returns orgId + role when a membership exists", async () => {
    query.mockResolvedValue({ rows: [{ org_id: INTERNAL_ORG_ID, role: "admin" }] });
    await expect(getMembership("u-1")).resolves.toEqual({ orgId: INTERNAL_ORG_ID, role: "admin" });
  });
});

describe("upsertMembership", () => {
  it("inserts a new membership row", async () => {
    query.mockResolvedValue({ rows: [] });
    await upsertMembership({ orgId: INTERNAL_ORG_ID, userId: "u-1", role: "operator", invitedBy: null });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO org_members"), [
      INTERNAL_ORG_ID,
      "u-1",
      "operator",
      null,
    ]);
  });
});

describe("listMembers / listPendingUsers", () => {
  it("maps member rows with role and last login", async () => {
    query.mockResolvedValue({
      rows: [
        {
          user_id: "u-1",
          email: "a@x.com",
          name: "A",
          role: "admin",
          last_login_at: new Date("2026-08-04T00:00:00.000Z"),
        },
      ],
    });
    await expect(listMembers(INTERNAL_ORG_ID)).resolves.toEqual([
      {
        userId: "u-1",
        email: "a@x.com",
        name: "A",
        role: "admin",
        lastLoginAt: "2026-08-04T00:00:00.000Z",
      },
    ]);
  });

  it("returns pending users (no org_members row)", async () => {
    query.mockResolvedValue({ rows: [{ user_id: "u-2", email: "b@x.com", name: null }] });
    await expect(listPendingUsers()).resolves.toEqual([
      { userId: "u-2", email: "b@x.com", name: null },
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("LEFT JOIN org_members"));
  });
});
