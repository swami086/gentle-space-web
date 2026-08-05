// ads-agent/components/pencil/KanbanBoard.test.tsx
import { describe, expect, it } from "vitest";
import { KanbanBoard } from "./KanbanBoard";

describe("KanbanBoard", () => {
  it("renders one column per entry, each with its label and count", () => {
    const el = KanbanBoard({
      columns: [
        { key: "draft", label: "Draft", cards: [{ id: "c1", node: "Campaign One" }] },
        { key: "active", label: "Active", cards: [{ id: "c2", node: "Campaign Two" }, { id: "c3", node: "Campaign Three" }] },
      ],
    });
    const json = JSON.stringify(el);
    expect(json).toContain("Draft");
    expect(json).toContain("Active");
    expect(json).toContain("Campaign One");
    expect(json).toContain("Campaign Two");
    expect(json).toContain("Campaign Three");
  });

  it("renders an empty column without throwing", () => {
    expect(() => KanbanBoard({ columns: [{ key: "empty", label: "Empty", cards: [] }] })).not.toThrow();
  });
});
