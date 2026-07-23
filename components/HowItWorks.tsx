import { HOW_IT_WORKS_CONTENT } from "@/lib/content-services";

export function HowItWorks() {
  const rows = [
    HOW_IT_WORKS_CONTENT.steps.slice(0, 3),
    HOW_IT_WORKS_CONTENT.steps.slice(3, 6),
  ];

  return (
    <section id="how-it-works" className="bg-[var(--surface)] px-6 py-24 lg:px-[160px]">
      <div className="mx-auto flex max-w-[1120px] flex-col items-center gap-14">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="inline-flex rounded-full bg-[var(--bg)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.4px] text-[var(--accent-dark)]">
            {HOW_IT_WORKS_CONTENT.kicker}
          </span>
          <h2 className="max-w-[640px] text-[28px] font-bold tracking-tight text-[var(--ink)] lg:text-[34px]">
            {HOW_IT_WORKS_CONTENT.heading}
          </h2>
        </div>

        <div className="flex w-full flex-col gap-10">
          {rows.map((row, i) => (
            <div key={i} className="grid gap-6 md:grid-cols-3">
              {row.map((step) => (
                <article key={step.label} className="flex flex-col gap-3">
                  <p className="text-[22px] font-bold text-[var(--ink-secondary)]">{step.label}</p>
                  <h3 className="text-[17px] font-semibold text-[var(--ink)]">{step.title}</h3>
                  <p className="text-sm leading-[1.5] text-[var(--muted)]">{step.body}</p>
                </article>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
