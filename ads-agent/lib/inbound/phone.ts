export function normalizeToE164(
  raw: string,
  defaultCountry?: "IN",
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = hasLeadingPlus
    ? trimmed.slice(1).replace(/\D/g, "")
    : trimmed.replace(/\D/g, "");

  if (hasLeadingPlus) {
    const normalized = `+${digits}`;
    return normalized.length >= 10 ? normalized : null;
  }

  if (defaultCountry === "IN" && digits.length === 10) {
    return `+91${digits}`;
  }

  return null;
}
