// ⚠️ SAMPLE DATA — replace every entry with real, closed placements before going
// live, or remove entries you can't substantiate. No client names by design
// (area / size / sector / type only). An empty array hides the section entirely.

export type Placement = {
  /** Bangalore corridor or area. */
  area: string;
  /** Approximate built-up area, in sq ft. */
  sizeSqft: number;
  /** Client sector, kept generic (no names). */
  sector: string;
  /** Space type: Office / Retail / Warehouse / Managed office / Coworking. */
  type: string;
};

export const RECENT_PLACEMENTS: Placement[] = [
  { area: "Whitefield", sizeSqft: 12000, sector: "SaaS / IT", type: "Office" },
  { area: "Koramangala", sizeSqft: 3500, sector: "D2C brand", type: "Retail" },
  { area: "Outer Ring Road", sizeSqft: 22000, sector: "Global capability centre", type: "Office" },
  { area: "HSR Layout", sizeSqft: 6000, sector: "Fintech startup", type: "Managed office" },
  { area: "Electronic City", sizeSqft: 40000, sector: "Logistics", type: "Warehouse" },
  { area: "Indiranagar", sizeSqft: 2200, sector: "F&B", type: "Retail" },
];
