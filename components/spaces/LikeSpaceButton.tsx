"use client";

import type { MouseEvent } from "react";
import { useLeadCapture } from "@/components/LeadCaptureContext";

type LikeSpaceButtonProps = {
  propertyName: string;
  propertyUrl: string;
  variant?: "pill" | "cta";
  className?: string;
};

function IconHeart({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  );
}

export function LikeSpaceButton({
  propertyName,
  propertyUrl,
  variant = "pill",
  className,
}: LikeSpaceButtonProps) {
  const { openModal } = useLeadCapture();

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    openModal({ propertyName, propertyUrl });
  };

  if (variant === "cta") {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={
          className ??
          "inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] active:translate-y-px"
        }
      >
        <IconHeart className="h-4 w-4" />
        Message on WhatsApp
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        className ??
        "inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs font-semibold text-[var(--accent)] transition hover:border-[var(--accent)] hover:bg-[var(--bg)] hover:text-[var(--accent-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] active:translate-y-px"
      }
    >
      <IconHeart className="h-4 w-4" />
      Like
    </button>
  );
}
