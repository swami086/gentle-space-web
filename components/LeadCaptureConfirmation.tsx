"use client";

export type LeadCaptureConfirmationProps = {
  onReopenWhatsApp: () => void;
  onDone: () => void;
};

export function LeadCaptureConfirmation({
  onReopenWhatsApp,
  onDone,
}: LeadCaptureConfirmationProps) {
  return (
    <div className="flex flex-col gap-4" role="status">
      <p className="text-[15px] leading-[1.45] text-[var(--ink)]">
        WhatsApp is opening in a new tab.
      </p>
      <p className="text-[13px] text-[var(--muted)]">
        Didn&apos;t see it?{" "}
        <button
          type="button"
          onClick={onReopenWhatsApp}
          className="font-semibold text-[var(--accent)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Open WhatsApp again
        </button>
      </p>
      <button
        type="button"
        onClick={onDone}
        className="inline-flex items-center justify-center rounded-[var(--radius)] bg-[var(--accent)] px-5 py-3.5 text-[15px] font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
      >
        Done
      </button>
    </div>
  );
}
