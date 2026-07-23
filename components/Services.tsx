import { SERVICES_CONTENT } from "@/lib/content-services";
import {
  IconBanknote,
  IconBuilding2,
  IconCalendarCheck,
  IconHandshake,
  IconSearch,
  IconTrendingUp,
} from "@/components/icons";

const SERVICE_ICONS = {
  "Tenant Representation": IconHandshake,
  "Managed & Coworking Advisory": IconBuilding2,
  "Custom Portfolio Strategy": IconTrendingUp,
  "Tenant Sourcing & Leasing": IconSearch,
  "Rent & Asset Positioning": IconBanknote,
  "Renewal & Retention": IconCalendarCheck,
} as const;

export function Services() {
  return (
    <section id="services" className="bg-[var(--bg)] px-6 py-24 lg:px-[160px]">
      <div className="mx-auto flex max-w-[1120px] flex-col items-center gap-14">
        <div className="flex max-w-[640px] flex-col items-center gap-4 text-center">
          <span className="inline-flex rounded-full bg-[var(--surface-tint)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.4px] text-[var(--accent-dark)]">
            {SERVICES_CONTENT.kicker}
          </span>
          <h2 className="text-[28px] font-bold tracking-tight text-[var(--ink)] lg:text-[34px]">
            {SERVICES_CONTENT.heading}
          </h2>
          <p className="max-w-[520px] text-base leading-[1.5] text-[var(--muted)]">
            {SERVICES_CONTENT.subtext}
          </p>
        </div>

        {SERVICES_CONTENT.groups.map((group) => (
          <div key={group.label} className="flex w-full flex-col items-center gap-6">
            <h3 className="text-center text-[13px] font-bold uppercase tracking-[0.6px] text-[var(--accent-dark)]">
              {group.label}
            </h3>
            <div className="grid w-full gap-6 md:grid-cols-3">
              {group.items.map((item) => {
                const Icon = SERVICE_ICONS[item.title as keyof typeof SERVICE_ICONS];
                return (
                  <article
                    key={item.title}
                    className="flex flex-col gap-3.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-7"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface-tint)] text-[var(--accent)]">
                      {Icon ? <Icon size={22} /> : null}
                    </div>
                    <h4 className="text-[17px] font-semibold text-[var(--ink)]">{item.title}</h4>
                    <p className="text-sm leading-[1.5] text-[var(--muted)]">{item.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
