import type { ListingSource } from "@/lib/listings/types";

export type DiscoveredListing = {
  sourceId: string;
  url: string;
};

export type RawListing = {
  source: ListingSource;
  sourceId: string;
  title: string;
  description: string;
  shortTeaser: string;
  address: string;
  area: string;
  city: string;
  lat: number | null;
  lng: number | null;
  amenities: string[];
  images: string[];
  pricingHint: string | null;
  propertyType: string | null;
  sourceUrl: string;
};

export type SourceAdapter = {
  source: ListingSource;
  discover(): Promise<DiscoveredListing[]>;
  fetchDetail(url: string): Promise<RawListing | null>;
};
