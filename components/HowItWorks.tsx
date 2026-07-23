import { HOW_IT_WORKS_CONTENT } from "@/lib/content-services";

export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-[var(--surface)] px-6 py-20 lg:px-[160px]">
      <div className="max-w-[1120px]">
        <p className="text-sm font-semibold">
          <span className="inline-flex rounded-full bg-[var(--bg)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-dark)]">
            {HOW_IT_WORKS_CONTENT.kicker}
          </span>
        </p>

        <div className="mt-4 max-w-[760px]">
          <h2 className="text-3xl font-semibold tracking-tight text-[var(--ink)] lg:text-5xl">
            {HOW_IT_WORKS_CONTENT.heading}
          </h2>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {HOW_IT_WORKS_CONTENT.steps.map((step) => (
            <article
              key={step.label}
              className="bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-md)] p-7"
            >
              <div className="inline-flex rounded-full bg-[var(--surface-tint)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-dark)]">
                {step.label}
              </div>
              <h3 className="mt-5 text-lg font-semibold tracking-tight text-[var(--ink)]">
                {step.title}
              </h3>
              <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                {step.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
