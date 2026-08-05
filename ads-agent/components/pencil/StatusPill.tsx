// ads-agent/components/pencil/StatusPill.tsx
import { createElement } from "react";
import { cn } from "@/lib/utils";

export type StatusTone = "hot" | "warm" | "cold" | "unscored" | "active" | "paused" | "draft";

const TONE_CLASS: Record<StatusTone, string> = {
  hot: "bg-status-hot/15 text-status-hot",
  warm: "bg-status-warm/15 text-status-warm",
  cold: "bg-status-cold/15 text-status-cold",
  unscored: "bg-status-unscored/15 text-status-unscored",
  active: "bg-status-positive/15 text-status-positive",
  paused: "bg-status-warm/15 text-status-warm",
  draft: "bg-muted text-muted-foreground",
};

const DOT_CLASS: Record<StatusTone, string> = {
  hot: "bg-status-hot",
  warm: "bg-status-warm",
  cold: "bg-status-cold",
  unscored: "bg-status-unscored",
  active: "bg-status-positive",
  paused: "bg-status-warm",
  draft: "bg-muted-foreground",
};

export function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  return createElement(
    "span",
    {
      className: cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
        TONE_CLASS[tone],
      ),
    },
    createElement("span", { className: cn("size-1.5 rounded-full", DOT_CLASS[tone]), "aria-hidden": "true" }),
    label,
  );
}
