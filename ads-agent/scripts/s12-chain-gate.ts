import {
  assertUntaintedForProposal,
  formatKanbanAgentMessage,
  parseKanbanAgentMessage,
} from "@/lib/agent/kanban-protocol";

export type LinkedChainResult = {
  rootTitle: string;
  childTitle: string;
  parentComment: string;
  childComment: string;
  mintProfiles: Array<"orchestrator" | "leads">;
};

export function simulateLinkedChain(input: {
  orgId: string;
  enquiryId: string;
}): LinkedChainResult {
  const { orgId, enquiryId } = input;

  const rootTitle = `Triage enquiry ${enquiryId} outcome and delegate leads follow-up`;
  const childTitle = `Queue broker proposals from enquiry ${enquiryId}`;

  const parentComment = formatKanbanAgentMessage({
    v: 1,
    intent: "decompose",
    orgId,
    recordIds: [enquiryId],
    taint: false,
    summary: `Delegated leads child to triage enquiry ${enquiryId} and queue proposals`,
  });

  const childComment = formatKanbanAgentMessage({
    v: 1,
    intent: "findings",
    orgId,
    recordIds: [enquiryId],
    taint: true,
    summary: `Enquiry ${enquiryId} triaged; broker proposal queued for human review`,
  });

  const parentMsg = parseKanbanAgentMessage(parentComment);
  const childMsg = parseKanbanAgentMessage(childComment);
  assertUntaintedForProposal(parentMsg);
  if (!childMsg.taint) throw new Error("child_comment_must_be_tainted");

  return {
    rootTitle,
    childTitle,
    parentComment,
    childComment,
    mintProfiles: ["orchestrator", "leads"],
  };
}

const isDirect =
  process.argv[1]?.endsWith("s12-chain-gate.ts") ||
  process.argv[1]?.endsWith("s12-chain-gate.js");
if (isDirect) {
  const orgId = process.env.ORCHESTRATOR_ORG_ID ?? process.env.LEADS_ORG_ID;
  const enquiryId = process.env.S12_GATE_ENQUIRY_ID;
  if (!orgId || !enquiryId) {
    console.error("s12-chain-gate: set ORCHESTRATOR_ORG_ID (or LEADS_ORG_ID) and S12_GATE_ENQUIRY_ID");
    process.exit(1);
  }
  const chain = simulateLinkedChain({ orgId, enquiryId });
  console.log(JSON.stringify({ ok: true, mintProfiles: chain.mintProfiles, rootTitle: chain.rootTitle }));
}
