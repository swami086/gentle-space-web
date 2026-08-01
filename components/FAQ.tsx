"use client";

import { useState } from "react";
import { Reveal } from "@/components/motion/Reveal";
import { FAQ_ITEMS } from "@/lib/content-faq";

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
