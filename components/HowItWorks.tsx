"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import { Reveal } from "@/components/motion/Reveal";
import { HOW_IT_WORKS_CONTENT } from "@/lib/content-services";

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconClipboard() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...strokeProps}>
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <path d="M9 12h6M9 16h4" />
    </svg>
  );
}
function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...strokeProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function IconChecklist() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...strokeProps}>
      <path d="M11 6h9M11 12h9M11 18h9" />
      <path d="m3 5 1.4 1.4L6 4" />
      <path d="m3 11 1.4 1.4L6 10" />
      <path d="m3 17 1.4 1.4L6 16" />
    </svg>
  );
}
function IconPin() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...strokeProps}>
      <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
function IconNote() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...strokeProps}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...strokeProps}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

const ICONS = [IconClipboard, IconSearch, IconChecklist, IconPin, IconNote, IconShield];

// One-shot glow bloom on the node as it lands, then settles flat.
const GLOW = [
  "0 0 0 0 rgba(123,90,200,0)",
  "0 0 20px 5px rgba(123,90,200,0.55)",
  "0 0 0 0 rgba(123,90,200,0)",
];

const rowV: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };
const nodeV: Variants = {
  hidden: { opacity: 0, scale: 0.55 },
  show: {
    opacity: 1,
    scale: 1,
    boxShadow: GLOW,
    transition: {
      duration: 0.5,
      ease: [0.2, 0.7, 0.2, 1],
      boxShadow: { duration: 1.1, times: [0, 0.22, 1] },
    },
  },
};
const lineV: Variants = {
  hidden: { scaleY: 0 },
  show: { scaleY: 1, transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] } },
};
const contentV: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] } },
};

export function HowItWorks() {
  const reduce = useReducedMotion();
  const steps = HOW_IT_WORKS_CONTENT.steps;

  return (
    <section
      id="how-it-works"
      className="border-y border-[var(--border)] bg-[var(--surface)] py-14"
    >
      <div className="mx-auto max-w-[1120px] px-5 lg:px-10">
        <Reveal className="mb-7 max-w-[640px]">
          <h2 className="text-[clamp(22px,2.6vw,28px)] font-semibold leading-[1.25] tracking-tight text-[var(--ink)]">
            {HOW_IT_WORKS_CONTENT.heading}
          </h2>
        </Reveal>

        <ol className="max-w-[720px] list-none p-0">
          {steps.map((step, i) => {
            const Icon = ICONS[i] ?? IconClipboard;
            const isLast = i === steps.length - 1;
            const nodeClass = isLast
              ? "bg-[var(--accent)] text-[var(--on-accent)]"
              : "bg-[var(--accent-soft)] text-[var(--accent)]";
            const content = (
              <>
                <div className="text-[13px] font-semibold text-[var(--accent)]">
                  {step.label}
                </div>
                <strong className="mt-0.5 block text-[16px] font-semibold text-[var(--ink)]">
                  {step.title}
                </strong>
                <p className="mt-1 text-[15px] leading-[1.6] text-[var(--muted)]">
                  {step.body}
                </p>
              </>
            );

            if (reduce) {
              return (
                <li key={step.label} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <span
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${nodeClass}`}
                    >
                      <Icon />
                    </span>
                    {!isLast && (
                      <span className="my-1.5 w-[2px] flex-1 bg-[var(--border)]" />
                    )}
                  </div>
                  <div className={isLast ? "" : "pb-6"}>{content}</div>
                </li>
              );
            }

            return (
              <motion.li
                key={step.label}
                className="flex gap-4"
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.5 }}
                variants={rowV}
              >
                <div className="flex flex-col items-center">
                  <motion.span
                    variants={nodeV}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${nodeClass}`}
                  >
                    <Icon />
                  </motion.span>
                  {!isLast && (
                    <motion.span
                      variants={lineV}
                      style={{ transformOrigin: "top" }}
                      className="my-1.5 w-[2px] flex-1 bg-[var(--border)]"
                    />
                  )}
                </div>
                <motion.div variants={contentV} className={isLast ? "" : "pb-6"}>
                  {content}
                </motion.div>
              </motion.li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
