import type { AttributionWindow, WindowState } from "./window";

export type CorridorSpendRow = { corridorId: string | null; spendInr: number };
export type CorridorEnquiryRow = { corridorId: string | null; enquiryCount: number };

export type CorridorAttribution = {
  corridorId: string;
  spendInr: number;
  enquiryCount: number;
  costPerEnquiryInr: number | null;
};

export type AttributionResidual = {
  unattributedSpendInr: number;
  unattributedEnquiryCount: number;
  spendWithoutEnquiriesInr: number;
  enquiriesWithoutSpendCount: number;
};

export type AttributionResult = {
  window: AttributionWindow;
  windowState: WindowState;
  corridors: CorridorAttribution[];
  residual: AttributionResidual;
  lateEnquiryCount: number;
  totals: { spendInr: number; enquiryCount: number };
};

export class AttributionConservationError extends Error {
  constructor(message: string) {
    super(`attribution is not conserved: ${message}`);
    this.name = "AttributionConservationError";
  }
}

const MONEY_EPSILON = 1e-6;

function costPerEnquiry(spendInr: number, enquiryCount: number): number | null {
  return enquiryCount > 0 ? spendInr / enquiryCount : null;
}

export function reconcile(input: {
  window: AttributionWindow;
  windowState: WindowState;
  spend: CorridorSpendRow[];
  enquiries: CorridorEnquiryRow[];
}): AttributionResult {
  const spendByCorridor = new Map<string, number>();
  let unattributedSpendInr = 0;

  for (const row of input.spend) {
    if (row.spendInr < 0) throw new Error(`negative spend for corridor ${row.corridorId}: ${row.spendInr}`);
    if (row.corridorId === null) unattributedSpendInr += row.spendInr;
    else spendByCorridor.set(row.corridorId, (spendByCorridor.get(row.corridorId) ?? 0) + row.spendInr);
  }

  const enquiriesByCorridor = new Map<string, number>();
  let unattributedEnquiryCount = 0;

  for (const row of input.enquiries) {
    if (row.enquiryCount < 0) throw new Error(`negative enquiry count: ${row.enquiryCount}`);
    if (row.corridorId === null) unattributedEnquiryCount += row.enquiryCount;
    else {
      enquiriesByCorridor.set(
        row.corridorId,
        (enquiriesByCorridor.get(row.corridorId) ?? 0) + row.enquiryCount,
      );
    }
  }

  const corridorIds = new Set([...spendByCorridor.keys(), ...enquiriesByCorridor.keys()]);
  const corridors: CorridorAttribution[] = [...corridorIds]
    .map((corridorId) => {
      const spendInr = spendByCorridor.get(corridorId) ?? 0;
      const enquiryCount = enquiriesByCorridor.get(corridorId) ?? 0;
      return { corridorId, spendInr, enquiryCount, costPerEnquiryInr: costPerEnquiry(spendInr, enquiryCount) };
    })
    .sort((a, b) => b.spendInr - a.spendInr || a.corridorId.localeCompare(b.corridorId));

  const residual: AttributionResidual = {
    unattributedSpendInr,
    unattributedEnquiryCount,
    spendWithoutEnquiriesInr: corridors
      .filter((c) => c.enquiryCount === 0)
      .reduce((t, c) => t + c.spendInr, 0),
    enquiriesWithoutSpendCount: corridors
      .filter((c) => c.spendInr === 0)
      .reduce((t, c) => t + c.enquiryCount, 0),
  };

  const result: AttributionResult = {
    window: input.window,
    windowState: input.windowState,
    corridors,
    residual,
    lateEnquiryCount: 0,
    totals: {
      spendInr: corridors.reduce((t, c) => t + c.spendInr, 0) + unattributedSpendInr,
      enquiryCount: corridors.reduce((t, c) => t + c.enquiryCount, 0) + unattributedEnquiryCount,
    },
  };

  assertConserved(result);
  return result;
}

export function assertConserved(result: AttributionResult): void {
  const spendSum =
    result.corridors.reduce((t, c) => t + c.spendInr, 0) + result.residual.unattributedSpendInr;
  if (Math.abs(spendSum - result.totals.spendInr) > MONEY_EPSILON) {
    throw new AttributionConservationError(
      `corridor spend plus unattributed spend is ${spendSum}, total spend is ${result.totals.spendInr}`,
    );
  }

  const enquirySum =
    result.corridors.reduce((t, c) => t + c.enquiryCount, 0) + result.residual.unattributedEnquiryCount;
  if (enquirySum !== result.totals.enquiryCount) {
    throw new AttributionConservationError(
      `corridor enquiries plus unattributed enquiries is ${enquirySum}, total is ${result.totals.enquiryCount}`,
    );
  }

  for (const c of result.corridors) {
    const expected = costPerEnquiry(c.spendInr, c.enquiryCount);
    const agrees =
      expected === null
        ? c.costPerEnquiryInr === null
        : c.costPerEnquiryInr !== null && Math.abs(c.costPerEnquiryInr - expected) <= MONEY_EPSILON;
    if (!agrees) {
      throw new AttributionConservationError(
        `corridor ${c.corridorId} reports cost per enquiry ${c.costPerEnquiryInr}, but ${c.spendInr} over ${c.enquiryCount} enquiries is ${expected}`,
      );
    }
  }
}

export function applyFrozenWindow(
  frozen: AttributionResult,
  fresh: AttributionResult,
): AttributionResult {
  if (frozen.windowState !== "closed") {
    throw new Error("applyFrozenWindow requires a closed window; open windows are recomputed in full");
  }
  return {
    ...frozen,
    lateEnquiryCount: Math.max(0, fresh.totals.enquiryCount - frozen.totals.enquiryCount),
  };
}
