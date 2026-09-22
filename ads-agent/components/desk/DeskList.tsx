"use client";

import { cn } from "@/lib/utils";
import type { DeskItem } from "@/lib/desk/types";
import { Badge } from "@/components/ui/badge";

const URGENCY_LABEL: Record<DeskItem["urgency"], string> = {
  now: "Now",
  today: "Today",
  later: "Later",
};

export function DeskList({
  items,
  selectedId,
  onSelect,
}: {
  items: DeskItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <ul className="flex flex-col gap-0.5" role="listbox" aria-label="Desk inbox">
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <li key={item.id}>
            <button
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(item.id)}
              className={cn(
                "flex w-full flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition-colors",
                selected
                  ? "border-primary/40 bg-accent"
                  : "border-transparent hover:bg-accent/60",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
                  {URGENCY_LABEL[item.urgency]}
                </Badge>
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{item.summary}</p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
