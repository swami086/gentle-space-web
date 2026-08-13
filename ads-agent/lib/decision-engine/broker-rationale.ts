import { stripSmuggle } from "./strip-smuggle";

export type BrokerRationaleInput = {
  kind: string;
  payload: Record<string, unknown>;
  triggeredRule: string;
};

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function genericFallback(input: BrokerRationaleInput): string {
  return `Rule "${input.triggeredRule}" triggered a "${input.kind}" proposal. See the payload for exact values.`;
}

function renderBudgetChange(payload: Record<string, unknown>, triggeredRule: string): string {
  const campaignId = asString(payload.campaignId) || "this campaign";
  const budget = asNumber(payload.newDailyBudgetInr);
  const budgetPart = budget === null ? "a new daily budget" : `daily budget to ${formatInr(budget)}`;
  return `Set ${budgetPart} for campaign ${campaignId} (rule: ${triggeredRule}).`;
}

function renderPause(payload: Record<string, unknown>, triggeredRule: string): string {
  const campaignId = asString(payload.campaignId) || "this campaign";
  return `Pause campaign ${campaignId} (rule: ${triggeredRule}).`;
}

function renderCreateCampaign(payload: Record<string, unknown>, triggeredRule: string): string {
  const corridor = asString(payload.corridor) || "the target area";
  const platform = asString(payload.platform) || "ads";
  const budget = asNumber(payload.dailyBudgetInr ?? payload.newDailyBudgetInr);
  const budgetPart = budget === null ? "a daily budget" : `${formatInr(budget)}/day`;
  return `Create a new ${platform} campaign in ${corridor} with ${budgetPart} (rule: ${triggeredRule}).`;
}

function renderAddNegativeKeyword(payload: Record<string, unknown>, triggeredRule: string): string {
  const campaignId = asString(payload.campaignId) || "this campaign";
  const keyword = asString(payload.keywordText) || "this term";
  return `Add negative keyword "${keyword}" to campaign ${campaignId} (rule: ${triggeredRule}).`;
}

function renderCampaignStrategy(payload: Record<string, unknown>, triggeredRule: string): string {
  const summary = asString(payload.summary);
  if (summary) return `${summary} (rule: ${triggeredRule}).`;

  const recommendations = Array.isArray(payload.recommendations) ? payload.recommendations.length : 0;
  const countPart = recommendations > 0 ? `${recommendations} recommendation(s)` : "strategy updates";
  return `Campaign strategy review: ${countPart} (rule: ${triggeredRule}).`;
}

function formatRequirementDetails(requirements: Record<string, unknown>): string {
  const parts: string[] = [];
  const minDesks = asNumber(requirements.minDesks);
  if (minDesks !== null) parts.push(`${minDesks} desks`);
  const corridor = asString(requirements.corridor);
  if (corridor) parts.push(`corridor ${corridor}`);
  return parts.length > 0 ? parts.join(", ") : "updated requirements";
}

function renderEnquiryRequirementUpdate(payload: Record<string, unknown>, triggeredRule: string): string {
  const enquiryId = asString(payload.enquiry_id) || "this enquiry";
  const requirements =
    payload.requirements && typeof payload.requirements === "object" && !Array.isArray(payload.requirements)
      ? (payload.requirements as Record<string, unknown>)
      : {};
  const details = formatRequirementDetails(requirements);
  return `Update enquiry ${enquiryId} requirements: ${details} (rule: ${triggeredRule}).`;
}

function renderMessageDraft(payload: Record<string, unknown>, triggeredRule: string): string {
  const enquiryId = asString(payload.enquiry_id) || "this enquiry";
  const channel = asString(payload.channel) || "message";
  const subject = asString(payload.subject);
  const subjectPart = subject ? ` — "${subject}"` : "";
  return `Draft ${channel} for enquiry ${enquiryId}${subjectPart} (rule: ${triggeredRule}).`;
}

function renderForKind(input: BrokerRationaleInput): string {
  switch (input.kind) {
    case "budget_change":
      return renderBudgetChange(input.payload, input.triggeredRule);
    case "pause":
      return renderPause(input.payload, input.triggeredRule);
    case "create_campaign":
      return renderCreateCampaign(input.payload, input.triggeredRule);
    case "add_negative_keyword":
      return renderAddNegativeKeyword(input.payload, input.triggeredRule);
    case "campaign_strategy":
      return renderCampaignStrategy(input.payload, input.triggeredRule);
    case "enquiry.requirement_update":
      return renderEnquiryRequirementUpdate(input.payload, input.triggeredRule);
    case "message.draft":
      return renderMessageDraft(input.payload, input.triggeredRule);
    default:
      return genericFallback(input);
  }
}

export function brokerRationale(input: BrokerRationaleInput): string {
  return stripSmuggle(renderForKind(input));
}
