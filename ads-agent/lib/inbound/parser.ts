export type ListingCreateSector = "residential" | "commercial_office";

export type ParsedInbound =
  | { type: "code"; code: string }
  | { type: "pause" }
  | { type: "stop" }
  | { type: "resume" }
  | { type: "leased" }
  | {
      type: "create";
      dailyMajor: number;
      sector: ListingCreateSector;
      goal: string;
    }
  | { type: "unknown" };

export function parseInboundText(text: string): ParsedInbound {
  const line = text.trim();

  if (/^\d{6}$/.test(line)) {
    return { type: "code", code: line };
  }

  switch (line.toUpperCase()) {
    case "PAUSE":
      return { type: "pause" };
    case "STOP":
      return { type: "stop" };
    case "RESUME":
      return { type: "resume" };
    case "LEASED":
      return { type: "leased" };
    default: {
      const created = parseCreateLine(line);
      return created ?? { type: "unknown" };
    }
  }
}

/** Same body on WhatsApp and SMS: a whole-number daily spend, then the goal. `office` as the second word selects a commercial office. */
function parseCreateLine(line: string): ParsedInbound | null {
  const match = line.match(/^(\d+)\s+(\S.*)$/);
  if (!match) return null;
  const dailyMajor = Number(match[1]);
  if (!Number.isSafeInteger(dailyMajor) || dailyMajor <= 0) return null;
  let rest = match[2].trim();
  let sector: ListingCreateSector = "residential";
  const office = rest.match(/^office\s+(\S.*)$/i);
  if (office) {
    sector = "commercial_office";
    rest = office[1].trim();
  }
  if (!rest) return null;
  return { type: "create", dailyMajor, sector, goal: rest };
}
