import { looksLikeLocality, stripScraperJunk } from "./address";

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

const SENSITIVE = [
  /₹/i,
  /\bRs\.?\b/i,
  /\bINR\b/i,
  /\d{4,}\s*(?:\/|per)/i,
  /\b(?:road|rd|street|st|avenue|lane|layout|plot|tower|wing|survey\s*no)\b/i,
  /\b\d+(?:st|nd|rd|th)\s+(?:floor|cross|block|phase)\b/i,
  /\b5\d{5}\b/,
  /\b(?:located|situated)\s+(?:at|on|in)\b/i,
  /\bwithin\s+\d+\s+meters?\b/i,
  /\b\d+\s+meters?\s+(?:away|from)\b/i,
  /\b\d+\s+minutes?\s+walk\b/i,
];

export function redactSensitiveText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const sentences = trimmed.split(SENTENCE_SPLIT).map((s) => s.trim()).filter(Boolean);
  const kept = sentences.filter((sentence) => !SENSITIVE.some((re) => re.test(sentence)));
  return kept.join(" ").trim();
}

export function sanitizeArea(area: string): string {
  const cleaned = stripScraperJunk(area);
  return looksLikeLocality(cleaned) ? cleaned : "";
}

function cityLabel(city: string): string {
  const t = city.trim();
  if (!t) return "";
  return t === "Bengaluru" ? "Bangalore" : t;
}

export function displayLocationLine(area: string, city: string): string {
  return [sanitizeArea(area), cityLabel(city)].filter(Boolean).join(", ");
}
