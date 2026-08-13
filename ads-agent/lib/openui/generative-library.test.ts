import { createParser } from "@openuidev/react-lang";
import { describe, expect, it } from "vitest";
import {
  ActionProposalView,
  CallPrepCardView,
  WhyCardView,
  generativeLibrary,
} from "./generative-library";

describe("generativeLibrary", () => {
  it("registers WhyCard, CallPrepCard, and ActionProposal with WhyCard as root", () => {
    expect(generativeLibrary.root).toBe("WhyCard");
    expect(Object.keys(generativeLibrary.components).sort()).toEqual(
      ["ActionProposal", "CallPrepCard", "WhyCard"].sort(),
    );
  });
});

describe("WhyCardView", () => {
  it("renders body and follow-ups without throwing on null optional fields", () => {
    expect(() =>
      WhyCardView({
        body: "CPL rose because Search spend increased.",
        citationIds: null,
        followUps: null,
      }),
    ).not.toThrow();
    const tree = WhyCardView({
      body: "CPL rose because Search spend increased.",
      citationIds: ["fact-1"],
      followUps: ["Which campaign?"],
    });
    const json = JSON.stringify(tree);
    expect(json).toContain("CPL rose");
    expect(json).toContain("fact-1");
    expect(json).toContain("Which campaign?");
  });
});

describe("CallPrepCardView", () => {
  it("renders three talking points with citations", () => {
    const tree = CallPrepCardView({
      points: [
        { text: "Budget headroom", citationIds: ["id-a"] },
        { text: "Corridor fit", citationIds: ["id-b"] },
        { text: "Timeline pressure", citationIds: ["id-c"] },
      ],
    });
    const json = JSON.stringify(tree);
    expect(json).toContain("Budget headroom");
    expect(json).toContain("Corridor fit");
    expect(json).toContain("Timeline pressure");
  });
});

describe("ActionProposalView", () => {
  it("renders title, summary, kind, and href", () => {
    const tree = ActionProposalView({
      title: "Review proposal",
      summary: "Spend is pacing hot on Whitefield.",
      kind: "navigate_proposal",
      href: "/proposals/abc",
      citationIds: ["cite-1"],
    });
    const json = JSON.stringify(tree);
    expect(json).toContain("Review proposal");
    expect(json).toContain("pacing hot");
    expect(json).toContain("navigate_proposal");
    expect(json).toContain("/proposals/abc");
  });
});

describe("generativeLibrary parser round-trip", () => {
  const parser = createParser(generativeLibrary.toJSONSchema());

  it("parses WhyCard with positional args", () => {
    const lang = `root = WhyCard("CPL rose because Search spend increased.", ["fact-1", "fact-2"], ["Which campaign?", "What changed?"])`;
    const result = parser.parse(lang);
    expect(result.meta.errors).toEqual([]);
    expect(result.root?.typeName).toBe("WhyCard");
    expect(result.root?.props).toMatchObject({
      body: "CPL rose because Search spend increased.",
      citationIds: ["fact-1", "fact-2"],
      followUps: ["Which campaign?", "What changed?"],
    });
  });

  it("parses CallPrepCard with exactly three cited points", () => {
    const lang = `root = CallPrepCard([
  { text: "Budget headroom", citationIds: ["id-a"] },
  { text: "Corridor fit", citationIds: ["id-b"] },
  { text: "Timeline pressure", citationIds: ["id-c"] },
])`;
    const result = parser.parse(lang);
    expect(result.meta.errors).toEqual([]);
    expect(result.root?.typeName).toBe("CallPrepCard");
    expect(result.root?.props.points).toHaveLength(3);
    expect(result.root?.props.points[0]).toMatchObject({
      text: "Budget headroom",
      citationIds: ["id-a"],
    });
  });

  it("parses ActionProposal with positional args (href omitted)", () => {
    const lang = `root = ActionProposal("Review proposal", "Spend is pacing hot", "navigate_proposal", ["cite-1"])`;
    const result = parser.parse(lang);
    expect(result.meta.errors).toEqual([]);
    expect(result.root?.typeName).toBe("ActionProposal");
    expect(result.root?.props).toMatchObject({
      title: "Review proposal",
      summary: "Spend is pacing hot",
      kind: "navigate_proposal",
      citationIds: ["cite-1"],
    });
  });

  it("parses ActionProposal with citationIds then optional href", () => {
    const lang = `root = ActionProposal("Open proposal", "Review pending changes", "navigate", ["cite-1"], "/proposals/abc")`;
    const result = parser.parse(lang);
    expect(result.meta.errors).toEqual([]);
    expect(result.root?.typeName).toBe("ActionProposal");
    expect(result.root?.props).toMatchObject({
      title: "Open proposal",
      summary: "Review pending changes",
      kind: "navigate",
      citationIds: ["cite-1"],
      href: "/proposals/abc",
    });
  });
});
