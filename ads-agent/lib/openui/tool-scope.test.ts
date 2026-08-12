import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
vi.mock("../auth/dal", () => ({ getSession }));

beforeEach(() => getSession.mockReset());

describe("toolScope", () => {
  it("returns the session's org scope", async () => {
    getSession.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      orgId: "10101010-1010-1010-1010-101010101010",
      role: "viewer",
    });
    const { toolScope } = await import("./tool-scope");
    expect(await toolScope()).toEqual({
      kind: "org",
      orgId: "10101010-1010-1010-1010-101010101010",
    });
  });

  it("throws when there is no session, rather than reading unscoped", async () => {
    getSession.mockResolvedValue(null);
    const { toolScope } = await import("./tool-scope");
    await expect(toolScope()).rejects.toThrow(/no session/);
  });

  it("never takes the tenant from tool arguments", async () => {
    const { toolScope } = await import("./tool-scope");
    expect(toolScope.length).toBe(0);
  });
});
