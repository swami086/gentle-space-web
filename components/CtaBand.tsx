"use client";

import { useLeadCapture } from "@/components/LeadCaptureContext";

export function CtaBand() {
  const { openModal } = useLeadCapture();

  return (
    <section className="bg-[var(--accent-dark)] px-6 py-[72px] lg:px-[160px]">
      <div className="mx-auto flex max-w-[720px] flex-col items-center gap-5 text-center">
        <h2 className="text-[28px] font-bold tracking-tight text-white lg:text-[32px]">
          Ready to find the right commercial space in Bangalore?
        </h2>
        <p className="max-w-[520px] text-base leading-[1.5] text-white/80">
          Share your brief on WhatsApp and we&apos;ll reply within the hour, with your private
          shortlist typically ready in about five working days.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={openModal}
            className="rounded-[var(--radius-sm)] bg-white px-8 py-3.5 text-[15px] font-semibold text-[var(--accent-dark)] transition hover:bg-[var(--surface-tint)]"
          >
            Get My Shortlist
          </button>
          <a
            href="/spaces"
            className="rounded-[var(--radius-sm)] border border-white/80 px-8 py-3.5 text-[15px] font-semibold text-white transition hover:bg-white/10"
          >
            Browse Spaces
          </a>
        </div>
      </div>
    </section>
  );
}
