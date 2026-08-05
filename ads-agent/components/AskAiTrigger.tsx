"use client";

import { createElement } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  /** Pre-seeded question, referencing the specific item's identity/data — e.g. "Explain why CPL
   * rose on Whitefield HSR Launch". */
  question: string;
  /** Opens the relevant chat surface (the embedded page chat if one exists for this domain,
   * otherwise the global Copilot) with `question` pre-seeded. Dependency-injected so this
   * component has no direct dependency on any specific chat surface's state. */
  onAsk: (question: string) => void;
  className?: string;
};

/**
 * Small sparkle-icon trigger, visible on hover — the concrete per-component handoff into the
 * model path (foundation spec's "AskAiTrigger — the per-component handoff"). A parent component
 * that wants this hover-reveal behavior wraps its container with `className="group"`; this
 * button's own className includes `opacity-0 group-hover:opacity-100` so it only appears when the
 * user hovers the parent (a KpiCard, an OpportunityCard, a table row, a board card, etc.).
 */
export function AskAiTrigger({ question, onAsk, className }: Props) {
  return createElement(
    "button",
    {
      type: "button",
      onClick: () => onAsk(question),
      "aria-label": `Ask AI: ${question}`,
      title: `Ask AI: ${question}`,
      className: cn(
        "flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 transition-opacity hover:text-card-foreground focus-visible:opacity-100 group-hover:opacity-100",
        className,
      ),
    },
    createElement(Sparkles, { className: "size-3.5", "aria-hidden": "true" }),
  );
}
