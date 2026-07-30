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

function joinTextParts(parts: (string | null)[]): string {
  return parts
    .map((p) => (typeof p === "string" ? p.trim() : p))
    .filter((p): p is string => Boolean(p))
    .join(" · ");
}

export function buildListingEmbeddingText(l: EmbeddingFields): string {
  return joinTextParts([
    l.title,
    l.area,
    l.city,
    l.propertyType,
    l.pricingHint,
    l.shortTeaser,
    l.description,
    l.amenities.length ? l.amenities.join(", ") : null,
  ]);
}

export function buildStructuredEmbeddingText(
  l: Pick<EmbeddingFields, "title" | "area" | "city" | "propertyType" | "pricingHint" | "amenities">,
): string {
  return joinTextParts([
    l.title,
    l.area,
    l.city,
    l.propertyType,
    l.pricingHint,
    l.amenities.length ? l.amenities.join(", ") : null,
  ]);
}

export function buildDescriptionEmbeddingText(
  l: Pick<EmbeddingFields, "shortTeaser" | "description">,
): string {
  return joinTextParts([l.shortTeaser, l.description]);
}
