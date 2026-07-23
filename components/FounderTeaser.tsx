import Image from "next/image";
import { SITE } from "@/lib/site";

export function FounderTeaser() {
  return (
    <section id="founder" className="bg-[var(--bg)] px-6 py-24 lg:px-[160px]">
      <div className="mx-auto flex max-w-[1120px] flex-col-reverse items-center gap-[72px] lg:flex-row">
        <div className="flex w-full flex-col gap-5">
          <span className="inline-flex w-fit rounded-full bg-[var(--surface-tint)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.4px] text-[var(--accent-dark)]">
            ABOUT THE FOUNDER
          </span>
          <h2 className="text-[28px] font-bold tracking-tight text-[var(--ink)] lg:text-[34px]">
            Meet Sanjay Singh
          </h2>
          <p className="text-[15px] font-semibold text-[var(--ink-secondary)]">
            Founder · Gentle Space Global Solutions · Bangalore
          </p>
          <p className="text-base leading-[1.6] text-[var(--muted)]">
            Sanjay Singh and his team of consultants specialise in Bangalore Commercial Real Estate
            and can meet the demand across any industry. He founded Gentle Space to help Companies
            and Property owners acheive thier goals in a high trust setting with minimal friction
            for both property Owners and Clients. Sanjay is an expert in the local market and is
            acutely aware of where demand is building, what rents will stick, and which properties
            fit which briefs. Companies have leveraged his expertise to establish office and retail
            presence in Bangalore over many years. His team is an expert in navigating and clearing
            blockers with a razor sharp focus in helping his clients achieve high quality, legally
            safe outcomes in a high trust setting.
          </p>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-[var(--muted)]">Office</p>
            <p className="text-sm font-semibold leading-[1.45] text-[var(--ink)]">
              {SITE.addressShort}
            </p>
            <a
              href={SITE.mapsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm text-[var(--accent-dark)] transition hover:text-[var(--accent)]"
            >
              Get directions on Google Maps
            </a>
            <p className="mt-2 text-xs font-semibold text-[var(--muted)]">Registration No. / GSTIN</p>
            <p className="text-sm font-semibold text-[var(--ink)]">{SITE.gstin}</p>
            <p className="mt-2 text-xs font-semibold text-[var(--muted)]">CIN</p>
            <p className="text-sm font-semibold text-[var(--ink)]">{SITE.cin}</p>
          </div>

          <a
            href={SITE.linkedinFounder}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-3 text-sm text-[var(--ink-secondary)] transition hover:text-[var(--ink)]"
          >
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-[var(--accent-dark)]" aria-hidden="true">
              <path d="M4.98 3.5C4.98 4.88 3.86 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.5 8.5h4V23h-4V8.5zM8.5 8.5h3.8v2h.05c.53-1 1.82-2.05 3.75-2.05 4.01 0 4.75 2.64 4.75 6.07V23h-4v-6.6c0-1.57-.03-3.59-2.19-3.59-2.19 0-2.53 1.71-2.53 3.48V23h-4V8.5z" />
            </svg>
            LinkedIn · Sanjay Singh
          </a>

          <a
            href="#founder"
            className="inline-flex w-fit items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent)] px-7 py-3.5 text-[15px] font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)]"
          >
            About the Founder
          </a>
        </div>

        <div className="w-full max-w-[420px] shrink-0 overflow-hidden rounded-[var(--radius-lg)]">
          <Image
            src="/sanjay-singh-portrait.jpg"
            alt="Sanjay Singh portrait"
            width={420}
            height={480}
            className="h-auto w-full object-cover"
          />
        </div>
      </div>
    </section>
  );
}
