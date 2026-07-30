type EmbeddingFields = {
  title: string;
  area: string;
  city: string;
  propertyType: string | null;
  pricingHint: string | null;
  shortTeaser: string;
  description: string;
  amenities: string[];
};

export function buildListingEmbeddingText(l: EmbeddingFields): string {
  const parts = [
    l.title,
    l.area,
    l.city,
    l.propertyType,
    l.pricingHint,
    l.shortTeaser,
    l.description,
    l.amenities.length ? l.amenities.join(", ") : null,
  ]
    .map((p) => (typeof p === "string" ? p.trim() : p))
    .filter((p): p is string => Boolean(p));
  return parts.join(" · ");
}
