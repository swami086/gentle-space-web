"use client";

import { useEffect, useState, type FormEvent } from "react";
import { buildWhatsAppUrl, NEED_LABELS, type NeedType } from "@/lib/whatsapp";
import { useLeadCapture } from "./LeadCaptureContext";

const NEED_OPTIONS: NeedType[] = ["office", "retail", "lease"];

export function LeadCaptureModal() {
  const { open, closeModal } = useLeadCapture();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [need, setNeed] = useState<NeedType>("office");
  const [brief, setBrief] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeModal();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeModal, open]);

  if (!open) {
    return null;
  }

  const canSubmit = Boolean(name.trim() && phone.trim() && brief.trim());

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    const url = buildWhatsAppUrl({
      name,
      phone,
      need,
      brief,
    });

    window.open(url, "_blank", "noopener,noreferrer");
    closeModal();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeModal();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-capture-title"
        className="w-full max-w-[600px] rounded-[var(--radius-md)] bg-[var(--bg)] p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="lead-capture-title" className="text-2xl font-semibold tracking-tight text-[var(--ink)]">
              Get your private property e-brochure
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-secondary)]">
              Share your brief. We'll send a private shortlist on WhatsApp.
            </p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            aria-label="Close lead capture modal"
            className="rounded-full p-2 text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--ink)]"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[var(--ink)]">Full name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-sm outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
              placeholder="Your name"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[var(--ink)]">WhatsApp number</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-sm outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
              placeholder="+91 90000 00000"
            />
          </label>

          <fieldset>
            <legend className="mb-2 block text-sm font-medium text-[var(--ink)]">I need</legend>
            <div className="flex flex-wrap gap-2">
              {NEED_OPTIONS.map((option) => {
                const selected = need === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setNeed(option)}
                    className={`rounded-full px-4 py-2 text-sm transition ${
                      selected
                        ? "bg-[var(--accent)] text-[var(--on-accent)]"
                        : "border border-[var(--border)] bg-[var(--surface-tint)] text-[var(--ink)] hover:border-[var(--accent)]"
                    }`}
                  >
                    {NEED_LABELS[option]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[var(--ink)]">Your brief</span>
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              rows={4}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-sm outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
              placeholder="Size, budget, location, timing..."
            />
          </label>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-3 text-sm font-medium text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send on WhatsApp
          </button>

          <p className="text-center text-xs text-[var(--muted)]">
            Opens WhatsApp with your brief ready to send to Gentle Space.
          </p>
        </form>
      </div>
    </div>
  );
}
