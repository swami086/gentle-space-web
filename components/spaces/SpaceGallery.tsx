"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type SpaceGalleryProps = {
  title: string;
  images: string[];
};

function IconClose({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function SpaceGallery({ title, images }: SpaceGalleryProps) {
  const hero = images[0];
  const rest = images.slice(1);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef<number | null>(null);
  const titleId = useId();
  const open = openIndex !== null && images.length > 0;

  useEffect(() => {
    setMounted(true);
  }, []);

  const openAt = (index: number) => {
    pendingScrollRef.current = index;
    setOpenIndex(index);
  };

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenIndex(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (openIndex === null) return;
    const pending = pendingScrollRef.current;
    if (pending === null) return;
    pendingScrollRef.current = null;
    requestAnimationFrame(() => {
      const node = scrollRef.current?.querySelector(`#photo-${pending}`);
      node?.scrollIntoView({ block: "start" });
    });
  }, [openIndex]);

  useEffect(() => {
    if (!open || !scrollRef.current) return;
    const root = scrollRef.current;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-photo-index]"));
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const idx = Number((visible.target as HTMLElement).dataset.photoIndex);
        if (Number.isFinite(idx)) setOpenIndex(idx);
      },
      { root, threshold: [0.35, 0.55, 0.75] },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [open, images.length]);

  const tour =
    open && mounted
      ? createPortal(
          <div
            className="fixed inset-0 z-[100] flex flex-col bg-[var(--bg)] text-[var(--ink)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)]/95 px-4 py-3 backdrop-blur lg:px-8">
              <button
                type="button"
                onClick={() => setOpenIndex(null)}
                className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
                aria-label="Close photo gallery"
              >
                <IconClose className="h-5 w-5" />
                Close
              </button>
              <p id={titleId} className="text-sm font-medium text-[var(--muted)]">
                {(openIndex ?? 0) + 1} / {images.length}
              </p>
              <span className="w-[5.5rem]" aria-hidden="true" />
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-6 lg:px-8">
              <ul className="mx-auto flex max-w-[920px] flex-col gap-6 pb-16">
                {images.map((src, index) => (
                  <li
                    key={`${src}-${index}`}
                    id={`photo-${index}`}
                    data-photo-index={index}
                    className="scroll-mt-20"
                  >
                    <img
                      src={src}
                      alt={`${title} — photo ${index + 1}`}
                      className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] object-contain"
                      loading={index === openIndex ? "eager" : "lazy"}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => hero && openAt(0)}
          disabled={!hero}
          className="group relative h-[400px] overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] text-left shadow-[0_1px_0_rgba(255,255,255,0.04),0_16px_40px_rgba(15,23,42,0.08)] transition hover:border-[var(--accent)] disabled:cursor-default"
          aria-label={hero ? `View photos of ${title}` : undefined}
        >
          {hero ? (
            // ponytail: plain img — listing images come from many third-party hostnames
            <img
              src={hero}
              alt={title}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
              loading="eager"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
              No photos available
            </div>
          )}
          {images.length > 1 ? (
            <span className="pointer-events-none absolute bottom-4 right-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)]/95 px-3.5 py-2 text-sm font-semibold text-[var(--ink)] shadow-sm">
              Show all photos
            </span>
          ) : null}
        </button>

        {rest.length > 0 ? (
          <ul className="flex flex-wrap gap-2.5">
            {rest.map((src, i) => {
              const index = i + 1;
              return (
                <li key={`${src}-${index}`} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => openAt(index)}
                    className="h-20 w-20 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] ring-offset-2 ring-offset-[var(--bg)] transition hover:border-[var(--accent)] hover:ring-2 hover:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    aria-label={`View photo ${index + 1} of ${images.length}`}
                  >
                    <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      {tour}
    </>
  );
}
