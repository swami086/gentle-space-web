/** Datastore spec §12.1: agents refuse to propose anything that changes spend when CDC
 *  lag exceeds this threshold. Fifteen minutes is the spec's default. */
export const ATTRIBUTION_MAX_LAG_SECONDS = 900;

export type AttributionFreshness = {
  computedAt: string;
  sourceWatermark: string;
  cdcLagSeconds: number;
  isStale: boolean;
};

export class StaleAttributionError extends Error {
  constructor(public readonly cdcLagSeconds: number) {
    super(
      `attribution is ${cdcLagSeconds}s behind the source, above the ${ATTRIBUTION_MAX_LAG_SECONDS}s ` +
        `threshold — refusing is correct behaviour, not an error`,
    );
    this.name = "StaleAttributionError";
  }
}

export function freshness(computedAt: Date, sourceWatermark: Date): AttributionFreshness {
  const lagMs = computedAt.getTime() - sourceWatermark.getTime();
  const cdcLagSeconds = Math.max(0, Math.round(lagMs / 1000));
  return {
    computedAt: computedAt.toISOString(),
    sourceWatermark: sourceWatermark.toISOString(),
    cdcLagSeconds,
    isStale: cdcLagSeconds > ATTRIBUTION_MAX_LAG_SECONDS,
  };
}

export function assertFreshEnoughToSpend(f: AttributionFreshness): void {
  if (f.isStale) throw new StaleAttributionError(f.cdcLagSeconds);
}
