export type ParsedInbound =
  | { type: "code"; code: string }
  | { type: "pause" }
  | { type: "stop" }
  | { type: "resume" }
  | { type: "leased" }
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
    default:
      return { type: "unknown" };
  }
}
