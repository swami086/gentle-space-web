import type { InsightContent, InsightFacts, InsightHighlight } from "./insight-types";

export const INSIGHT_SYSTEM = `You explain why a Bangalore coworking space matches a user's search.
Return only JSON with this shape:
{
  "summary": "one sentence",
  "highlights": [{ "label": "short label", "detail": "short phrase" }]
}
Rules:
- Use ONLY the facts in the user message. Never invent places, distances, amenities or prices.
- Emphasise what the search asked for. At most 4 highlights.
- Each detail must be under 90 characters. No markdown.
- Do not list drawbacks, cons, downsides or considerations.`;

const MAX_HIGHLIGHTS = 4;
const MAX_DESCRIPTION_CHARS = 600;

export function buildInsightUserText(facts: InsightFacts): string {
  const lines = [
    `Search: ${facts.query}`,
    `Space: ${facts.title}`,
    `Area: ${facts.area || "unknown"}, ${facts.city || "Bengaluru"}`,
  ];

  if (facts.propertyType) lines.push(`Type: ${facts.propertyType}`);
  if (facts.pricingHint) lines.push(`Pricing: ${facts.pricingHint}`);
  if (facts.amenities.length > 0) lines.push(`Amenities: ${facts.amenities.join(", ")}`);
  if (facts.description) {
    lines.push(`Description: ${facts.description.slice(0, MAX_DESCRIPTION_CHARS)}`);
  }

  for (const group of facts.nearby) {
    const places = group.places.map((p) => `${p.name} (${p.distanceLabel})`).join(", ");
    if (places) lines.push(`Nearby ${group.label}: ${places}`);
  }

  return lines.join("\n");
}

export function emptyInsightContent(): InsightContent {
  return { summary: "", highlights: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseInsightContent(raw: unknown): InsightContent {
  if (!isRecord(raw)) return emptyInsightContent();

  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  const highlights: InsightHighlight[] = [];

  if (Array.isArray(raw.highlights)) {
    for (const item of raw.highlights) {
      if (highlights.length >= MAX_HIGHLIGHTS) break;
      if (!isRecord(item)) continue;
      const label = typeof item.label === "string" ? item.label.trim() : "";
      const detail = typeof item.detail === "string" ? item.detail.trim() : "";
      if (!label || !detail) continue;
      highlights.push({ label, detail });
    }
  }

  return { summary, highlights };
}

export function parseInsightJson(raw: string): InsightContent {
  try {
    return parseInsightContent(JSON.parse(raw));
  } catch {
    return emptyInsightContent();
  }
}
