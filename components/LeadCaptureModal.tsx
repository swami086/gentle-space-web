"use client";

import { useEffect, useState, type FormEvent } from "react";
import { buildWhatsAppUrl, NEED_LABELS, type NeedType } from "@/lib/whatsapp";
import { useLeadCapture } from "./LeadCaptureContext";

const NEED_OPTIONS: NeedType[] = ["office", "retail", "lease"];

function IconClose({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function IconWhatsApp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

export function LeadCaptureModal() {
  const { open, closeModal } = useLeadCapture();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [need, setNeed] = useState<NeedType>("office");
  const [brief, setBrief] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeModal, open]);

  if (!open) return null;

  const canSubmit = Boolean(name.trim() && phone.trim() && brief.trim());

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    window.open(buildWhatsAppUrl({ name, phone, need, brief }), "_blank", "noopener,noreferrer");
    closeModal();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(30,22,48,0.6)] px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeModal();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-capture-title"
        className="flex w-full max-w-[600px] flex-col gap-6 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)] p-9"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h2 id="lead-capture-title" className="text-2xl font-bold tracking-tight text-[var(--ink)]">
              Get your private property e-brochure
            </h2>
            <p className="text-[15px] leading-[1.5] text-[var(--muted)]">
              Share your brief. We’ll send a private shortlist on WhatsApp.
            </p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            aria-label="Close lead capture modal"
            className="shrink-0 text-[var(--muted)] transition hover:text-[var(--ink)]"
          >
            <IconClose className="h-[22px] w-[22px]" />
          </button>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-[var(--ink-secondary)]">Full name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-[15px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
              placeholder="Your name"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-[var(--ink-secondary)]">WhatsApp number</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-[15px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
              placeholder="+91 …"
            />
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-semibold text-[var(--ink-secondary)]">I need</legend>
            <div className="flex flex-wrap gap-2">
              {NEED_OPTIONS.map((option) => {
                const selected = need === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setNeed(option)}
                    className={`rounded-[var(--radius-sm)] px-3.5 py-2.5 text-[13px] font-semibold transition ${
                      selected
                        ? "bg-[var(--accent)] text-[var(--on-accent)]"
                        : "border border-[var(--border)] bg-[var(--surface-tint)] text-[var(--ink)]"
                    }`}
                  >
                    {NEED_LABELS[option]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-[var(--ink-secondary)]">Your brief</span>
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              rows={4}
              className="h-[100px] w-full resize-none rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-3.5 text-[15px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
              placeholder="Corridors, size, budget, timing…"
            />
          </label>

          <div className="flex flex-col gap-2.5">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-5 py-3.5 text-[15px] font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconWhatsApp className="h-[18px] w-[18px]" />
              Send on WhatsApp
            </button>
            <p className="text-center text-[13px] text-[var(--muted)]">
              Opens WhatsApp with your brief ready to send to Gentle Space.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
