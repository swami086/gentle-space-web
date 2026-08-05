// ads-agent/components/pencil/KanbanBoard.tsx
"use client";

import { Reorder } from "framer-motion";
import { createElement, type ReactNode } from "react";
import { KanbanColumn } from "./KanbanColumn";

export type KanbanBoardColumn = {
  key: string;
  label: string;
  cards: { id: string; node: ReactNode }[];
};

/** Horizontally-scrolling column layout with Framer Motion's Reorder for in-column drag ordering.
 * Cross-column drag (moving a card to a different column) is handled by the page-level caller
 * (Task 13/14) via HTML5 drag-and-drop on each card's wrapper, not by this component — Reorder.Group
 * only reorders within one list; a column boundary crossing is a real state change (status/stage),
 * which the caller owns since it knows what that mutation means for its domain. */
export function KanbanBoard({
  columns,
  onReorderColumn,
}: {
  columns: KanbanBoardColumn[];
  onReorderColumn?: (columnKey: string, orderedIds: string[]) => void;
}) {
  return createElement(
    "div",
    { className: "flex gap-4 overflow-x-auto pb-2" },
    columns.map((column) =>
      createElement(
        KanbanColumn,
        { key: column.key, label: column.label, count: column.cards.length },
        createElement(
          Reorder.Group,
          {
            axis: "y",
            values: column.cards.map((c) => c.id),
            onReorder: (orderedIds: string[]) => onReorderColumn?.(column.key, orderedIds),
            className: "flex flex-col gap-2",
          },
          column.cards.map((card) =>
            createElement(Reorder.Item, { key: card.id, value: card.id }, card.node),
          ),
        ),
      ),
    ),
  );
}
