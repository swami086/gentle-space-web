export type AllocationBasis = "equal_split";

/** Backend spec BD4: campaigns are corridor-level, so per-space spend cannot be measured.
 *  `isEstimate` is a literal `true` so a measurement cannot be passed as an estimate, nor
 *  an estimate rendered as a measurement. `basis` keeps the rule legible and swappable. */
export type PerSpaceCostEstimate = {
  isEstimate: true;
  basis: AllocationBasis;
  corridorId: string;
  listingId: string;
  estimatedSpendShareInr: number;
  estimatedCostPerEnquiryInr: number | null;
};

export function allocateEqualSplit(input: {
  corridorId: string;
  spendInr: number;
  enquiryCount: number;
  listingIds: string[];
}): PerSpaceCostEstimate[] {
  if (input.spendInr < 0) throw new Error(`cannot allocate negative spend: ${input.spendInr}`);
  if (input.listingIds.length === 0) return [];

  const share = input.spendInr / input.listingIds.length;
  const perEnquiry = input.enquiryCount > 0 ? input.spendInr / input.enquiryCount : null;

  return input.listingIds.map((listingId) => ({
    isEstimate: true as const,
    basis: "equal_split" as const,
    corridorId: input.corridorId,
    listingId,
    estimatedSpendShareInr: share,
    estimatedCostPerEnquiryInr: perEnquiry,
  }));
}
