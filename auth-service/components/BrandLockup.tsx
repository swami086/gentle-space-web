type BrandLockupProps = {
  className?: string;
};

/**
 * Lockup: ink wordmark + "Admin" as a tracked accent qualifier, hairline separator.
 * Mirrors the main site's BrandWordmark pattern (ink core + accent submark) so the
 * admin gateway reads as the same product family, not a separate brand.
 */
export function BrandLockup({ className = "" }: BrandLockupProps) {
  return (
    <span className={`inline-flex items-center gap-[0.45em] whitespace-nowrap tracking-tight text-foreground ${className}`.trim()}>
      <span className="leading-none">Gentle Space</span>
      <span aria-hidden="true" className="h-[0.72em] w-px shrink-0 bg-border" />
      <span className="shrink-0 text-[0.72em] font-bold leading-none tracking-[0.2em] text-primary">
        ADMIN
      </span>
    </span>
  );
}
