"use client";

import { useState } from "react";

const FAQ_ITEMS = [
  {
    question: "How do fees work?",
    answer:
      "We charge no fees for standard requirements. For highly customised needs where we invest our efforts to find properties outside of our standard inventory list, we charge a fixed fee.",
  },
  {
    question: "Which Bangalore locations do you cover?",
    answer:
      "Gentle Space covers all areas in Bangalore and can meet any custom requirements, We can accelerate across high growth areas like Whitefield, Outer Ring Road, Koramangala, Indiranagar, HSR Layout, Electronic City, MG Road, and Sarjapur Road.",
  },
  {
    question: "How are commercial real estate consultants different from property listings?",
    answer:
      "Property listings are often inflated and mask crucial details that could present legal and commercial risk for client businesses. Gentle Space cater to highly customised needs for clients in a high trust manner.",
  },
  {
    question: "How long does the consulting process take?",
    answer:
      "A custom shortlist usually follows the brief within about five working days. Brief to signed lease can anywhere be between 1 to 4 weeks, depending on requirements.",
  },
  {
    question: "Do you handle verification, legal, and paperwork?",
    answer:
      "Yes. Gentle Space provides end-to-end support including verification, legal, and associated paperwork through handover, plus renewals and expansions after you move in.",
  },
  {
    question: "Why choose Gentle Space as commercial real estate consultants in Bangalore?",
    answer:
      "Gentle Space specialises in custom commercial real estate requirements in Bangalore for companies and property owners, with end-to-end verification, legal, and paperwork.",
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
