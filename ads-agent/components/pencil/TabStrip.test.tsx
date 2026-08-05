// ads-agent/components/pencil/TabStrip.test.tsx
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname }));
vi.mock("next/link", () => ({
  default: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) =>
    createElement("a", { href, className }, children),
}));

import { TabStrip } from "./TabStrip";

describe("TabStrip", () => {
  it("renders every tab's label", () => {
    usePathname.mockReturnValue("/campaigns");
    const el = TabStrip({ tabs: [{ href: "/campaigns", label: "Board" }, { href: "/proposals", label: "Proposals" }] });
    const json = JSON.stringify(el);
    expect(json).toContain("Board");
    expect(json).toContain("Proposals");
  });

  it("marks the tab matching the current pathname as active", () => {
    usePathname.mockReturnValue("/proposals");
    const el = TabStrip({ tabs: [{ href: "/campaigns", label: "Board" }, { href: "/proposals", label: "Proposals" }] });
    const json = JSON.stringify(el);
    // active tab carries the "text-foreground" class; inactive carries "text-muted-foreground"
    const proposalsIndex = json.indexOf("Proposals");
    const boardIndex = json.indexOf("Board");
    expect(json.slice(Math.max(0, proposalsIndex - 200), proposalsIndex)).toContain("text-foreground");
    expect(json.slice(Math.max(0, boardIndex - 200), boardIndex)).toContain("text-muted-foreground");
  });
});
