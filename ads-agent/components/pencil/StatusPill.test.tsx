// ads-agent/components/pencil/StatusPill.test.tsx
import { describe, expect, it } from "vitest";
import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  it("renders the label text", () => {
    const el = StatusPill({ tone: "hot", label: "Hot" });
    expect(JSON.stringify(el)).toContain("Hot");
  });

  it("applies a distinct class per tone", () => {
    const hot = StatusPill({ tone: "hot", label: "Hot" });
    const cold = StatusPill({ tone: "cold", label: "Cold" });
    expect(JSON.stringify(hot)).not.toBe(JSON.stringify(cold));
  });

  it.each(["hot", "warm", "cold", "unscored", "active", "paused", "draft"] as const)(
    "does not throw for tone=%s",
    (tone) => {
      expect(() => StatusPill({ tone, label: tone })).not.toThrow();
    },
  );
});
