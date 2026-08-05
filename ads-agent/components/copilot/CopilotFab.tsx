"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopilot } from "./CopilotProvider";

type Props = {
  /** Rule-based, SQL/code-computed alert flag (foundation spec's Proactive signaling section) —
   * not computed by this component; the caller supplies it. No task in this plan wires a real
   * value (see this plan's Global Constraints) — defaults to false until one does. */
  hasAlert?: boolean;
};

/** Floating trigger button, shown on every admin page — toggles the Copilot panel open/closed. */
export function CopilotFab({ hasAlert = false }: Props) {
  const { isOpen, toggle } = useCopilot();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isOpen ? "Close AI Copilot" : "Open AI Copilot"}
      aria-expanded={isOpen}
      className={cn(
        "fixed bottom-6 right-6 z-40 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105",
      )}
    >
      <Sparkles className="size-5" aria-hidden="true" />
      {hasAlert && (
        <span
          aria-hidden="true"
          className="absolute right-0 top-0 size-3 rounded-full border-2 border-background bg-destructive"
        />
      )}
    </button>
  );
}
