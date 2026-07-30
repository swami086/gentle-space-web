import type { NearbyGroup } from "../places/types";

export type InsightHighlight = {
  label: string;
  detail: string;
};

export type InsightContent = {
  summary: string;
  highlights: InsightHighlight[];
};

export type InsightFacts = {
  title: string;
  area: string;
  city: string;
  propertyType: string | null;
  pricingHint: string | null;
  amenities: string[];
  description: string;
  query: string;
  nearby: NearbyGroup[];
};

export type InsightResponse = {
  listingId: string;
  summary: string;
  highlights: InsightHighlight[];
  nearby: NearbyGroup[];
};
