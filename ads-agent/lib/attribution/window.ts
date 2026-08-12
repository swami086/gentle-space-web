/** IST is UTC+05:30 and has no daylight saving, so the offset is a constant rather than
 *  a timezone-database lookup. This is what lets attribution windows align to a broker's
 *  calendar day without adding a dependency. */
export const ATTRIBUTION_TIMEZONE_OFFSET_MINUTES = 330;

/** A window closes 14 days after its end date and its figures are frozen from then on.
 *  Both the enquiry loop and Google Ads conversion import settle well inside two weeks. */
export const ATTRIBUTION_CLOSE_DAYS = 14;

const MS_PER_DAY = 86_400_000;

/** Inclusive IST calendar dates, `YYYY-MM-DD`. */
export type AttributionWindow = { startDate: string; endDate: string };

export type WindowState = "open" | "closed";

export function istCalendarDate(at: Date): string {
  const shifted = new Date(at.getTime() + ATTRIBUTION_TIMEZONE_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function dateOnlyMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`);
}

export function trailingWindow(days: number, now: Date): AttributionWindow {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`attribution window must span at least 1 day, got ${days}`);
  }
  const endDate = istCalendarDate(now);
  const startDate = new Date(dateOnlyMs(endDate) - (days - 1) * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  return { startDate, endDate };
}

export function windowState(w: AttributionWindow, now: Date): WindowState {
  const closesOnMs = dateOnlyMs(w.endDate) + ATTRIBUTION_CLOSE_DAYS * MS_PER_DAY;
  return dateOnlyMs(istCalendarDate(now)) >= closesOnMs ? "closed" : "open";
}

export function classifyEnquiry(
  firstSeenAt: Date,
  w: AttributionWindow,
): "in_window" | "outside" {
  const day = istCalendarDate(firstSeenAt);
  return day >= w.startDate && day <= w.endDate ? "in_window" : "outside";
}
