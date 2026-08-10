"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shared "Ask Hermes" toggle dropped into all 4 chat panels — see
 * docs/superpowers/specs/2026-08-10-hermes-chat-integration-design.md. */
export function HermesModeToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onToggle}
      aria-pressed={active}
    >
      <Sparkles className="size-3.5" />
      {active ? "Hermes mode" : "Ask Hermes"}
    </Button>
  );
}
