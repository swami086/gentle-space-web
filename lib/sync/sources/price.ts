export type PriceUnit = "month" | "day" | "week" | "hour" | "year" | "seat";

/**
 * Maps a unit fragment as written on a source page to a canonical unit.
 * Order matters: "/pp/day" and "/ desk / month" mention a seat unit too, but the
 * time unit is the one that makes the amount comparable.
 */
export function normalizePriceUnit(raw: string | null | undefined): PriceUnit | null {
  if (!raw) return null;
  const text = raw.toLowerCase();
  if (/month|monthly|\/\s*mo\b/.test(text)) return "month";
  if (/day|daily/.test(text)) return "day";
  if (/week/.test(text)) return "week";
  if (/hour|\bhr\b/.test(text)) return "hour";
  if (/year|annual/.test(text)) return "year";
  if (/seat|desk|person|\bpp\b/.test(text)) return "seat";
  return null;
}

/**
 * Reads the unit that follows an amount. Sources write it as a suffix ("/day"),
 * behind a footnote marker ("/\* month"), or with a seat qualifier
 * ("/ desk / month"), so scan a short window rather than a fixed pattern.
 */
export function unitAfterAmount(text: string, fromIndex: number, window = 24): PriceUnit | null {
  return normalizePriceUnit(text.slice(fromIndex, fromIndex + window));
}

/**
 * Canonical stored form, e.g. "₹12,345/month". Returns null when the amount or
 * the unit is unknown — a price without a unit cannot be compared, and guessing
 * one is how a per-day rate ends up filtered as a monthly rate.
 */
export function formatPricingHint(
  amount: string | null | undefined,
  unit: PriceUnit | null,
): string | null {
  const digits = (amount ?? "").replace(/\D/g, "");
  if (!digits || !unit) return null;
  return `₹${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}/${unit}`;
}

export type PriceBasis = "exact" | "from";

export type StoredPrice = {
  amountInr: number;
  unit: PriceUnit;
  basis: PriceBasis;
  /** Comparable monthly figure, or null when the unit cannot be converted. */
  monthlyInr: number | null;
};

const MONTHLY_MULTIPLIER: Partial<Record<PriceUnit, number>> = {
  month: 1,
  day: 22,
  week: 4.3,
};

/**
 * Reads a stored `pricing_hint` back into a comparable figure. Tolerates every
 * shape the scrapers have written historically ("₹5999 /Month", "₹ 6500/month",
 * "₹600/day"). Returns null when the unit is unknown, so callers treat the price
 * as absent rather than comparing a day rate against a monthly budget.
 */
export function parseStoredPrice(hint: string | null | undefined): StoredPrice | null {
  if (!hint) return null;
  const match = hint.match(/₹\s*([\d,]+)/);
  if (!match || match.index === undefined) return null;

  const amountInr = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amountInr) || amountInr <= 0) return null;

  const unit = unitAfterAmount(hint, match.index + match[0].length, 40);
  if (!unit) return null;

  const multiplier = MONTHLY_MULTIPLIER[unit];
  return {
    amountInr,
    unit,
    basis: /^\s*from\b/i.test(hint) ? "from" : "exact",
    monthlyInr: multiplier ? Math.round(amountInr * multiplier) : null,
  };
}

/**
 * Finds the first ₹ amount in `text` and pairs it with the unit that follows.
 * Callers must narrow `text` to the subject listing's own pricing region first.
 */
export function extractPricingHint(text: string): string | null {
  const match = text.match(/₹\s*([\d,]+)/);
  if (!match || match.index === undefined) return null;
  const unit = unitAfterAmount(text, match.index + match[0].length);
  return formatPricingHint(match[1], unit);
}
