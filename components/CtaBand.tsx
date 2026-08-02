"use client";

import { useLeadCapture } from "@/components/LeadCaptureContext";
import { Reveal } from "@/components/motion/Reveal";

export function CtaBand() {
  const { openModal } = useLeadCapture();

  return (
    <section className="bg-[var(--accent)]">
      <Reveal className="mx-auto flex max-w-[1120px] flex-col items-center gap-3 px-5 py-12 text-center lg:px-10">
        <h2 className="max-w-[28ch] font-display text-[clamp(20px,2.4vw,26px)] font-semibold leading-snug text-[var(--on-accent)]">
          Ready to find the right commercial space in Bangalore?
        </h2>
        <p className="max-w-[46ch] text-sm leading-relaxed text-[var(--on-accent)]/85">
          Share your brief on WhatsApp and we&apos;ll usually reply within the hour, with your private
          shortlist typically ready in about five working days.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2.5">
          <button
            type="button"
            onClick={openModal}
            className="rounded-[var(--radius)] bg-[var(--on-accent)] px-6 py-2.5 text-sm font-semibold text-[var(--accent-dark)] transition hover:opacity-90"
          >
            Share your brief
          </button>
          <a
            href="/spaces"
            className="rounded-[var(--radius)] border border-[var(--on-accent)]/55 px-6 py-2.5 text-sm font-semibold text-[var(--on-accent)] transition hover:bg-[var(--on-accent)]/10"
          >
            See available spaces
          </a>
        </div>
      </Reveal>
    </section>
  );
}
