// ads-agent/components/hermes/HermesModeToggle.test.tsx
import { describe, expect, it, vi } from "vitest";
import { HermesModeToggle } from "./HermesModeToggle";

describe("HermesModeToggle", () => {
  it("labels itself 'Ask Hermes' when inactive", () => {
    const el = HermesModeToggle({ active: false, onToggle: () => {} });
    expect(JSON.stringify(el)).toContain("Ask Hermes");
  });

  it("labels itself 'Hermes mode' and is aria-pressed when active", () => {
    const el = HermesModeToggle({ active: true, onToggle: () => {} });
    expect(JSON.stringify(el)).toContain("Hermes mode");
    expect(el.props["aria-pressed"]).toBe(true);
  });

  it("wires onToggle directly as the click handler", () => {
    const onToggle = vi.fn();
    const el = HermesModeToggle({ active: false, onToggle });
    expect(el.props.onClick).toBe(onToggle);
  });
});
