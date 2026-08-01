import { Reveal } from "@/components/motion/Reveal";
import { HOW_IT_WORKS_CONTENT } from "@/lib/content-services";

export function HowItWorks() {
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

        <ol className="grid list-none gap-0 p-0 md:grid-cols-2 md:gap-x-8">
          {HOW_IT_WORKS_CONTENT.steps.map((step, i) => (
            <li key={step.label} className="border-b border-[var(--border)] py-3.5">
              <Reveal
                delay={i * 0.03}
                className="grid grid-cols-[32px_1fr] gap-3"
              >
                <span className="pt-0.5 text-xs font-bold text-[var(--accent)]">
                  {step.label}
                </span>
                <div>
                  <strong className="mb-1 block text-[15px] font-semibold text-[var(--ink)]">
                    {step.title}
                  </strong>
                  <span className="text-[13px] leading-[1.5] text-[var(--muted)]">
                    {step.body}
                  </span>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
