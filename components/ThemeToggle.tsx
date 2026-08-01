"use client";

import { useTheme, type ThemeChoice } from "@/components/ThemeProvider";

const ORDER: ThemeChoice[] = ["system", "light", "dark"];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="rounded-[var(--radius)] border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
      aria-label={`Theme: ${theme}. Click for ${next}.`}
    >
      {theme === "system" ? "Auto" : theme === "light" ? "Light" : "Dark"}
    </button>
  );
}
