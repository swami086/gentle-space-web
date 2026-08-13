import { describe, expect, it } from "vitest";
import {
  assertUntaintedForProposal,
  parseKanbanAgentMessage,
} from "@/lib/agent/kanban-protocol";
import { simulateLinkedChain } from "./s12-chain-gate";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const ENQ = "00000000-0000-4000-8000-0000000000bb";

describe("s12-chain-gate", () => {
  it("simulateLinkedChain uses orchestrator and leads profiles", () => {
    const chain = simulateLinkedChain({ orgId: ORG, enquiryId: ENQ });
    expect(chain.mintProfiles).toEqual(["orchestrator", "leads"]);
  });

  it("parent decompose comment parses and is not tainted", () => {
    const chain = simulateLinkedChain({ orgId: ORG, enquiryId: ENQ });
    const parent = parseKanbanAgentMessage(chain.parentComment);
    expect(parent.intent).toBe("decompose");
    expect(parent.taint).toBe(false);
    expect(parent.orgId).toBe(ORG);
    expect(() => assertUntaintedForProposal(parent)).not.toThrow();
  });

  it("child findings comment parses and is tainted", () => {
    const chain = simulateLinkedChain({ orgId: ORG, enquiryId: ENQ });
    const child = parseKanbanAgentMessage(chain.childComment);
    expect(child.intent).toBe("findings");
    expect(child.taint).toBe(true);
    expect(child.recordIds).toEqual([ENQ]);
    expect(() => assertUntaintedForProposal(child)).toThrow(/tainted_source/);
  });

  it("titles are outcome-oriented, not activity verbs like Analyse", () => {
    const chain = simulateLinkedChain({ orgId: ORG, enquiryId: ENQ });
    for (const title of [chain.rootTitle, chain.childTitle]) {
      expect(title).not.toMatch(/^Analyse\b/i);
      expect(title).not.toMatch(/^Analyze\b/i);
      expect(title).toMatch(/outcome|queue|proposal|triage/i);
    }
    expect(chain.rootTitle).toContain(ENQ);
    expect(chain.childTitle).toContain(ENQ);
  });
});
