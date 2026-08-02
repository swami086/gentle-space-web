import { IconPin } from "@/components/icons";
import { Reveal } from "@/components/motion/Reveal";
import { CORRIDORS } from "@/lib/corridors";

export function MicroMarkets() {
  return (
    <section
      id="locations"
      className="border-y border-[var(--border)] bg-[var(--surface)]"
    >
      <Reveal className="mx-auto max-w-[1120px] px-5 py-14 lg:px-10">
        <h2 className="font-display text-[clamp(22px,2.6vw,28px)] font-semibold leading-[1.25] text-[var(--ink)]">
          We cover all locations in and around Bengaluru.
        </h2>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-[1.7] text-[var(--ink-secondary)]">
          These corridors see the most activity — open any one for a local guide.
        </p>
        <ul className="mt-5 flex flex-wrap gap-2.5">
          {CORRIDORS.map((corridor) => (
            <li key={corridor.slug}>
              <a
                href={`/bangalore/${corridor.slug}`}
                className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2 text-[14px] font-medium text-[var(--ink-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <IconPin className="h-[15px] w-[15px] shrink-0 text-[var(--accent)]" />
                {corridor.name}
              </a>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}
