"use client";

import { useState } from "react";

const FAQ_ITEMS = [
  {
    question: "How do fees work?",
    answer:
      "Standard requirements cost nothing. If we need to search outside our existing network for something highly specific, we agree a fixed fee with you first.",
  },
  {
    question: "Which Bangalore locations do you cover?",
    answer:
      "All of Bangalore and the areas around it. Whitefield, Outer Ring Road, Koramangala, Indiranagar, HSR Layout, Electronic City, MG Road, and Sarjapur Road see the most activity, and that's just a sample of where we work.",
  },
  {
    question: "How are commercial real estate consultants different from property listings?",
    answer:
      "Listings show you what's available. They don't tell you if the building has legal issues, if the landlord is reliable, or if the price is inflated. We check all of that before you tour anything.",
  },
  {
    question: "How long does the consulting process take?",
    answer:
      "A shortlist usually follows your brief within five working days. Getting from brief to signed lease typically takes one to four weeks, depending on what you need.",
  },
  {
    question: "Do you handle verification, legal, and paperwork?",
    answer:
      "Yes, through handover, and we stay involved for renewals and expansions after you've moved in.",
  },
  {
    question: "Why choose Gentle Space as commercial real estate consultants in Bangalore?",
    answer:
      "We work across every commercial property type in Bangalore, for both companies and property owners, and we stay on the deal through verification, legal, and paperwork instead of handing you off after the intro call.",
  },
] as const;

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="px-6 py-20 lg:px-[160px]">
      <div className="max-w-[920px]">
        <p className="text-sm font-semibold">
          <span className="inline-flex rounded-full bg-[var(--surface-tint)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-dark)]">
            FAQ
          </span>
        </p>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-[var(--ink)] lg:text-5xl">
          FAQs: commercial real estate consultants in Bangalore
        </h2>

        <div className="mt-10 space-y-3">
          {FAQ_ITEMS.map((item, index) => {
            const isOpen = openIndex === index;
            const panelId = `faq-panel-${index}`;
            const buttonId = `faq-button-${index}`;

            return (
              <div
                key={item.question}
                className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)]"
              >
                <button
                  id={buttonId}
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-[var(--surface-tint)]"
                >
                  <span className="text-base font-medium text-[var(--ink)]">{item.question}</span>
                  <span
                    aria-hidden="true"
                    className="text-2xl leading-none text-[var(--accent-dark)]"
                  >
                    {isOpen ? "−" : "+"}
                  </span>
                </button>

                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  hidden={!isOpen}
                  className="px-5 pb-5"
                >
                  <p className="max-w-[780px] text-sm leading-7 text-[var(--ink-secondary)]">
                    {item.answer}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
