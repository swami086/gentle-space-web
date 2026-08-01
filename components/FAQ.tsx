"use client";

import { useState } from "react";
import { Reveal } from "@/components/motion/Reveal";

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
    question: "Why choose Gentle Space CRE as commercial real estate consultants in Bangalore?",
    answer:
      "We work across every commercial property type in Bangalore, for both companies and property owners, and we stay on the deal through verification, legal, and paperwork instead of handing you off after the intro call.",
  },
] as const;

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="py-14">
      <div className="mx-auto max-w-[720px] px-5 lg:px-10">
        <Reveal className="mb-5">
          <h2 className="text-[clamp(22px,2.6vw,28px)] font-semibold leading-[1.25] tracking-tight text-[var(--ink)]">
            FAQs: commercial real estate consultants in Bangalore
          </h2>
        </Reveal>

        <div className="border-t border-[var(--border)]">
          {FAQ_ITEMS.map((item, index) => {
            const isOpen = openIndex === index;
            const panelId = `faq-panel-${index}`;
            const buttonId = `faq-button-${index}`;

            return (
              <div key={item.question} className="border-b border-[var(--border)]">
                <Reveal delay={index * 0.03}>
                  <button
                    id={buttonId}
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                    className="w-full py-3.5 text-left text-[15px] font-semibold text-[var(--ink)] transition-colors hover:text-[var(--accent)]"
                  >
                    {item.question}
                  </button>

                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                    hidden={!isOpen}
                  >
                    <p className="pb-3.5 text-sm leading-[1.6] text-[var(--ink-secondary)]">
                      {item.answer}
                    </p>
                  </div>
                </Reveal>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
