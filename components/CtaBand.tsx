"use client";

import { useLeadCapture } from "@/components/LeadCaptureContext";

export function CtaBand() {
  const { openModal } = useLeadCapture();

  return (
    <section className="px-6 py-20 lg:px-[160px]">
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-6 py-10 lg:px-10 lg:py-12">
        <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center">
          <div className="max-w-[760px]">
            <h2 className="text-3xl font-semibold tracking-tight text-[var(--ink)] lg:text-5xl">
              Need custom commercial real estate requirements in Bangalore?
            </h2>
            <p className="mt-4 text-base leading-7 text-[var(--ink-secondary)]">
              Share your custom brief. We’ll send a private property shortlist as an e-brochure on WhatsApp.
            </p>
          </div>

          <button
            type="button"
            onClick={openModal}
            className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-7 py-3.5 text-sm font-medium text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)]"
          >
            Contact Us
          </button>
        </div>
      </div>
    </section>
  );
}
