import { SITE } from "@/lib/site";

type BrandWordmarkProps = {
  className?: string;
  /** Always show (Commercial Real Estate). Default: from `lg` up (header room). */
  expandAlways?: boolean;
};

/**
 * Lockup: ink wordmark + CRE submark + expanded form in parentheses.
 * Expansion is muted and smaller so CRE stays the accent signal.
 */
export function BrandWordmark({
  className = "",
  expandAlways = false,
}: BrandWordmarkProps) {
  return (
    <span
      className={`inline-flex items-center gap-[0.45em] whitespace-nowrap tracking-tight text-[var(--ink)] ${className}`.trim()}
    >
      <span className="leading-none">{SITE.nameCore}</span>
      <span
        aria-hidden="true"
        className="h-[0.72em] w-px shrink-0 bg-[var(--border)]"
      />
      <span className="inline-flex shrink-0 items-baseline gap-[0.35em] leading-none">
        <span className="text-[0.72em] font-bold tracking-[0.2em] text-[var(--accent)]">
          {SITE.nameQualifier}
        </span>
        <span
          className={
            expandAlways
              ? "text-[0.58em] font-medium tracking-normal text-[var(--muted)]"
              : "hidden text-[0.58em] font-medium tracking-normal text-[var(--muted)] lg:inline"
          }
        >
          ({SITE.nameQualifierExpanded})
        </span>
      </span>
    </span>
  );
}
