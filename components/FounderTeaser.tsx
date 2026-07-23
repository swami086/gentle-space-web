import Image from "next/image";
import { SITE } from "@/lib/site";

export function FounderTeaser() {
  return (
    <section id="founder" className="px-6 py-20 lg:px-[160px]">
      <div className="grid gap-10 rounded-[var(--radius-lg)] bg-[var(--surface)] p-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-center lg:p-10">
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)]">
          <Image
            src="/sanjay-singh-portrait.jpg"
            alt="Sanjay Singh portrait"
            width={720}
            height={860}
            className="h-full w-full object-cover"
          />
        </div>

        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-dark)]">
            ABOUT THE FOUNDER
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-[var(--ink)] lg:text-5xl">
            Meet Sanjay Singh
          </h2>
          <p className="mt-3 text-sm font-medium text-[var(--ink-secondary)]">
            Founder · Gentle Space Global Solutions · Bangalore
          </p>
          <p className="mt-6 max-w-[62ch] text-base leading-8 text-[var(--ink)]">
            Sanjay Singh and his team of consultants specialise in Bangalore Commercial Real
            Estate and can meet the demand across any industry. He founded Gentle Space to help
            Companies and Property owners acheive thier goals in a high trust setting with minimal
            friction for both property Owners and Clients. Sanjay is an expert in the local market
            and is acutely aware of where demand is building, what rents will stick, and which
            properties fit which briefs. Companies have leveraged his expertise to establish
            office and retail presence in Bangalore over many years. His team is an expert in
            navigating and clearing blockers with a razor sharp focus in helping his clients
            achieve high quality, legally safe outcomes in a high trust setting.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                Office
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--ink)]">{SITE.addressShort}</p>
              <a
                href={SITE.mapsUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-3 inline-flex text-sm font-medium text-[var(--accent-dark)] transition hover:text-[var(--accent)]"
              >
                Get directions on Google Maps
              </a>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                Registration details
              </p>
              <dl className="mt-3 space-y-3 text-sm leading-6 text-[var(--ink)]">
                <div>
                  <dt className="font-medium text-[var(--ink-secondary)]">Registration No. / GSTIN</dt>
                  <dd>{SITE.gstin}</dd>
                </div>
                <div>
                  <dt className="font-medium text-[var(--ink-secondary)]">CIN</dt>
                  <dd>{SITE.cin}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
            <a
              href={SITE.linkedinFounder}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent)] px-5 py-3 text-sm font-medium text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)]"
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
    </section>
  );
}
