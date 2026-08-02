"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import {
  IconChecklist,
  IconClipboard,
  IconNote,
  IconPin,
  IconSearch,
  IconShield,
} from "@/components/icons";
import { Reveal } from "@/components/motion/Reveal";
import { HOW_IT_WORKS_CONTENT } from "@/lib/content-services";

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
                      <Icon className="h-[22px] w-[22px]" />
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
                    <Icon className="h-[22px] w-[22px]" />
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
