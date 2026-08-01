import { SITE } from "@/lib/site";

type BrandWordmarkProps = {
  className?: string;
};

/**
 * Lockup: ink wordmark + CRE as accent submark (hairline separator, wide tracking).
 * Never truncate the core name (mobile was collapsing to "G…").
 */
export function BrandWordmark({ className = "" }: BrandWordmarkProps) {
  return (
    <span
      className={`inline-flex items-center gap-[0.45em] whitespace-nowrap tracking-tight text-[var(--ink)] ${className}`.trim()}
    >
      <span className="leading-none">{SITE.nameCore}</span>
      <span
        aria-hidden="true"
        className="h-[0.72em] w-px shrink-0 bg-[var(--border)]"
      />
      <span className="shrink-0 text-[0.72em] font-bold leading-none tracking-[0.2em] text-[var(--accent)]">
        {SITE.nameQualifier}
      </span>
    </span>
  );
}
