import Image from "next/image";
import { Reveal } from "@/components/motion/Reveal";
import { SITE } from "@/lib/site";

export function FounderTeaser() {
  return (
    <section id="founder" className="bg-[var(--surface)] py-14">
      <Reveal className="mx-auto max-w-[1120px] px-5 lg:px-10">
        <div className="grid items-start gap-7 lg:grid-cols-[240px_1fr] lg:gap-10">
          <div className="max-w-[280px] overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)]">
            <Image
              src="/sanjay-singh-portrait.jpg"
              alt="Sanjay Singh portrait"
              width={280}
              height={340}
              className="aspect-[4/5] w-full object-cover"
            />
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
              ABOUT THE FOUNDER
            </p>
            <h2 className="font-display mt-1 text-[26px] font-semibold tracking-tight text-[var(--ink)]">
              Meet Sanjay Singh
            </h2>
            <p className="mt-1 text-[13px] font-semibold text-[var(--ink-secondary)]">
              Founder · Gentle Space Global Solutions · Bangalore
            </p>
            <p className="mt-3.5 max-w-[62ch] text-[15px] leading-[1.7] text-[var(--ink)]">
              Raised in Bangalore, Sanjay is a former corporate professional who launched Gentle
              Space to pursue his passion back in 2024. Sanjay has worked across a broad range of
              commercial real estate requirements in the city and brings deep, intricate knowledge
              of the local geography and ecosystem which very few real estate consultants possess.
              This was the motivation for him to leave his corporate role and pursue a venture in
              commercial real estate. Today, his clientele ranges from tech companies wanting to
              open their first Bangalore office, F&amp;B establishments, and manufacturing
              businesses looking for that ideal space. He is also a highly trusted consultant for
              overseas businesses arriving in India.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                  Office
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-[var(--ink)]">
                  {SITE.addressShort}
                </p>
                <a
                  href={SITE.mapsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-2 inline-flex text-sm font-medium text-[var(--accent-dark)] transition hover:text-[var(--accent)]"
                >
                  Get directions on Google Maps
                </a>
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                  Registration details
                </p>
                <dl className="mt-2 space-y-2.5 text-sm leading-relaxed text-[var(--ink)]">
                  <div>
                    <dt className="font-medium text-[var(--ink-secondary)]">
                      Registration No. / GSTIN
                    </dt>
                    <dd>{SITE.gstin}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-[var(--ink-secondary)]">CIN</dt>
                    <dd>{SITE.cin}</dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href={SITE.linkedinFounder}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)]"
              >
                LinkedIn · Sanjay Singh
              </a>
              <a
                href="#founder"
                className="inline-flex items-center justify-center text-sm font-medium text-[var(--accent-dark)] transition hover:text-[var(--accent)]"
              >
                About the Founder
                <span aria-hidden="true" className="ml-1.5">
                  →
                </span>
              </a>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
