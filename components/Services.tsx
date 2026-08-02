import {
  IconBuilding,
  IconBuildings,
  IconChartLine,
  IconRefresh,
  IconSofa,
  IconUserSearch,
} from "@/components/icons";
import { Reveal } from "@/components/motion/Reveal";
import { SERVICES_CONTENT } from "@/lib/content-services";

const GROUP_ICONS = [
  [IconBuilding, IconSofa, IconBuildings],
  [IconUserSearch, IconChartLine, IconRefresh],
];

export function Services() {
  return (
    <section id="services" className="py-14">
      <div className="mx-auto max-w-[1120px] px-5 lg:px-10">
        <Reveal className="mb-7 max-w-[640px]">
          <h2 className="text-[clamp(22px,2.6vw,28px)] font-semibold leading-tight tracking-tight text-[var(--ink)]">
            {SERVICES_CONTENT.heading}
          </h2>
          <p className="mt-2.5 text-[15px] leading-relaxed text-[var(--muted)]">
            {SERVICES_CONTENT.subtext}
          </p>
        </Reveal>

        <div className="grid gap-8 lg:grid-cols-2 lg:gap-10">
          {SERVICES_CONTENT.groups.map((group, groupIndex) => (
            <div key={group.label}>
              <h3 className="mb-3 border-b-2 border-[var(--accent)] pb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--accent)]">
                {group.label}
              </h3>
              <ul className="flex flex-col">
                {group.items.map((item, itemIndex) => {
                  const Icon = GROUP_ICONS[groupIndex]?.[itemIndex] ?? IconBuilding;
                  return (
                    <li
                      key={item.title}
                      className="border-b border-[var(--border)] py-3.5"
                    >
                      <Reveal delay={(groupIndex * 3 + itemIndex) * 0.04}>
                        <div className="flex items-start gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--accent-soft)] text-[var(--accent)]">
                            <Icon className="h-[19px] w-[19px]" />
                          </span>
                          <div className="grid gap-1">
                            <strong className="text-[15px] font-semibold text-[var(--ink)]">
                              {item.title}
                            </strong>
                            <span className="text-sm leading-relaxed text-[var(--muted)]">
                              {item.body}
                            </span>
                          </div>
                        </div>
                      </Reveal>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
