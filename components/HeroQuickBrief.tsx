"use client";

import { useState } from "react";
import { useLeadCapture } from "@/components/LeadCaptureContext";
import { CONTENT } from "@/lib/content";
import { NEED_LABELS, type NeedType } from "@/lib/whatsapp";

const NEED_OPTIONS: NeedType[] = ["office", "retail", "warehouse", "lease"];

// Inline hero brief: captures "what you need"; the modal then collects "who you are"
// and hands off to WhatsApp. Keeps the primary conversion in the first viewport.
export function HeroQuickBrief() {
  const { openModal } = useLeadCapture();
  const [need, setNeed] = useState<NeedType>("office");
  const [brief, setBrief] = useState("");

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    openModal({ need, brief: brief.trim() });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 lg:p-5"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-semibold text-[var(--ink-secondary)]">
          {CONTENT.hero.needLabel}
        </legend>
        <div className="flex flex-wrap gap-2">
          {NEED_OPTIONS.map((option) => {
            const selected = need === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                onClick={() => setNeed(option)}
                className={`rounded-[var(--radius)] px-3.5 py-2 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] ${
                  selected
                    ? "border border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)] shadow-sm"
                    : "border border-[var(--border)] bg-[var(--bg)] text-[var(--ink-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                }`}
              >
                {NEED_LABELS[option]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <input
        value={brief}
        onChange={(event) => setBrief(event.target.value)}
        aria-label="Your brief"
        placeholder={CONTENT.hero.briefPlaceholder}
        className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-[15px] text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)] dark:placeholder:text-[var(--ink-secondary)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <button
          type="submit"
          className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-7 py-3.5 text-[15px] font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
        >
          {CONTENT.hero.primaryCta}
        </button>
        <a
          href="/spaces"
          className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-[var(--ink)] transition hover:text-[var(--accent)]"
        >
          {CONTENT.hero.secondaryCta}
          <span aria-hidden="true">→</span>
        </a>
      </div>

      <p className="text-sm leading-[1.4] text-[var(--muted)]">
        {CONTENT.hero.incentive}
      </p>
    </form>
  );
}
