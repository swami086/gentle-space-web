// ads-agent/components/pencil/KanbanColumn.tsx
import { createElement, type ReactNode } from "react";

export function KanbanColumn({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  return createElement(
    "div",
    { className: "flex w-72 shrink-0 flex-col gap-3 rounded-xl bg-surface p-3" },
    createElement(
      "div",
      { className: "flex items-center justify-between px-1" },
      createElement("span", { className: "text-sm font-medium text-foreground" }, label),
      createElement(
        "span",
        { className: "rounded-full bg-surface-raised px-2 py-0.5 text-xs text-muted-foreground" },
        count,
      ),
    ),
    createElement("div", { className: "flex flex-col gap-2 overflow-y-auto" }, children),
  );
}
