import {
  hasCityMarker,
  localityFromAddress,
  looksLikeLocality,
} from "../listings/address";
import { formatPricingHint, parseStoredPrice } from "./sources/price";
import { isPricingWeak } from "./enrich-weak";

export type ExtractConfidence = "high" | "medium" | "low";
export type ExtractResult = {
  locality: string | null;
  address: string | null;
  monthly_price_inr: number | null;
  price_basis: "exact" | "from" | null;
  brand_match: boolean;
  confidence: ExtractConfidence;
  evidence: string | null;
};

const BARE_CITY = /^(?:Bengaluru|Bangalore)$/i;
const JUNK_LOCALITY = /\b(?:floor|door|plot)\b/i;

export function normalizeLocalityKey(locality: string): string {
  return locality.trim().toLowerCase().replace(/\s+/g, " ");
}

export function gateLocation(
  result: ExtractResult,
  opts: { pass2Locality?: string | null } = {},
): { accept: true; area: string; address: string } | { accept: false } {
  const rawAddress = result.address?.trim() || "";
  const fromAddress = rawAddress && hasCityMarker(rawAddress) ? localityFromAddress(rawAddress) : "";
  const locality = (result.locality ?? "").trim() || fromAddress;
  if (!locality || BARE_CITY.test(locality) || JUNK_LOCALITY.test(locality) || !looksLikeLocality(locality)) {
    return { accept: false };
  }

  const agreed =
    opts.pass2Locality != null &&
    normalizeLocalityKey(opts.pass2Locality) === normalizeLocalityKey(locality);
  const confidenceOk = result.confidence === "high" || result.confidence === "medium" || agreed;
  if (!confidenceOk) return { accept: false };

  if (rawAddress && hasCityMarker(rawAddress)) {
    return { accept: true, area: fromAddress || locality, address: rawAddress };
  }
  return { accept: true, area: locality, address: "" };
}

export function gatePrice(
  result: ExtractResult,
  currentHint: string | null,
): { accept: true; pricingHint: string } | { accept: false } {
  if (!isPricingWeak(currentHint)) return { accept: false };
  if (result.monthly_price_inr == null) return { accept: false };
  if (result.confidence !== "high" && result.confidence !== "medium") return { accept: false };

  const formatted = formatPricingHint(String(result.monthly_price_inr), "month");
  if (!formatted) return { accept: false };
  const pricingHint = result.price_basis === "from" ? `from ${formatted}` : formatted;
  const parsed = parseStoredPrice(pricingHint);
  if (parsed == null || parsed.monthlyInr == null) return { accept: false };
  return { accept: true, pricingHint };
}

