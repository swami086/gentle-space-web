import { describe, expect, it } from "vitest";
import { NAV_GROUPS, visibleNavGroups } from "./nav-config";

describe("visibleNavGroups", () => {
  it("shows only Overview in Workspace, and no Admin group, for a viewer", () => {
    const groups = visibleNavGroups("viewer");
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("workspace");
    expect(groups[0].items.map((item) => item.label)).toEqual(["Overview"]);
  });

  it("shows all of Workspace but no Admin group for an operator", () => {
    const groups = visibleNavGroups("operator");
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("workspace");
    expect(groups[0].items.map((item) => item.label)).toEqual(["Overview", "Campaigns", "Proposals"]);
  });

  it("shows both groups in full for an admin", () => {
    const groups = visibleNavGroups("admin");
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((item) => item.label)).toEqual(["Overview", "Campaigns", "Proposals"]);
    expect(groups[1].items.map((item) => item.label)).toEqual(["Usage & Credits", "Users", "Settings"]);
  });

  it("returns no groups at all for a null role", () => {
    expect(visibleNavGroups(null)).toEqual([]);
  });

  it("NAV_GROUPS itself has the two groups and their real hrefs, unfiltered", () => {
    expect(NAV_GROUPS.map((g) => g.key)).toEqual(["workspace", "admin"]);
    expect(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))).toEqual([
      "/",
      "/campaigns",
      "/proposals",
      "/credits",
      "/users",
      "/settings",
    ]);
  });
});
