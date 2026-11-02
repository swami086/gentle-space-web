export type OutboundMarket = "IN" | "AU";

export type OutboundKind = "approval" | "finding" | "move" | "failure";

export type RenderOutboundInput = {
  market: OutboundMarket;
  kind: OutboundKind;
  handle: string;
  code?: string;
  ceilingMinor?: number;
  oldShares?: number[];
  newShares?: number[];
  reason?: string;
};

export type RenderOutboundResult = {
  channel: "whatsapp" | "sms";
  body: string;
};

function channelFor(market: OutboundMarket): RenderOutboundResult["channel"] {
  return market === "IN" ? "whatsapp" : "sms";
}

function formatCeiling(market: OutboundMarket, ceilingMinor: number): string {
  const major = ceilingMinor / 100;
  if (market === "IN") {
    return `₹${major.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  }
  return `$${major.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatShareBudgets(shares: number[]): string {
  return shares.join(", ");
}

function renderApproval(input: RenderOutboundInput): string {
  const ceiling =
    input.ceilingMinor != null
      ? formatCeiling(input.market, input.ceilingMinor)
      : "the approved ceiling";
  const code = input.code ?? "";
  return (
    `${input.handle}: Approve ads up to ${ceiling} total spend. ` +
    `Reply ${code} to build. Share moves inside this ceiling run without a new code. ` +
    `No reply means no change for this approval.`
  );
}

function renderFinding(input: RenderOutboundInput): string {
  const code = input.code ?? "";
  const reason = input.reason ?? "Action recommended.";
  return (
    `${input.handle}: ${reason} Reply ${code} to apply. No reply means no change.`
  );
}

function renderMove(input: RenderOutboundInput): string {
  const oldShares = formatShareBudgets(input.oldShares ?? []);
  const newShares = formatShareBudgets(input.newShares ?? []);
  const ceiling =
    input.ceilingMinor != null
      ? formatCeiling(input.market, input.ceilingMinor)
      : "unchanged";
  return (
    `${input.handle}: Share budgets updated. ` +
    `Old: ${oldShares}. New: ${newShares}. Ceiling unchanged at ${ceiling} (${input.ceilingMinor}).`
  );
}

function renderFailure(input: RenderOutboundInput): string {
  const reason = input.reason ?? "Try again or contact support.";
  return `${input.handle}: Action failed. ${reason}`;
}

export function renderOutbound(input: RenderOutboundInput): RenderOutboundResult {
  const channel = channelFor(input.market);
  switch (input.kind) {
    case "approval":
      return { channel, body: renderApproval(input) };
    case "finding":
      return { channel, body: renderFinding(input) };
    case "move":
      return { channel, body: renderMove(input) };
    case "failure":
      return { channel, body: renderFailure(input) };
  }
}
