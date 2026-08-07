import { describe, expect, it } from "vitest";
import { createParser } from "@openuidev/lang-core";
import { platformLibrary } from "./platform-library";
import {
  ensureOpenUiRootAssignment,
  extractOpenUiStatement,
  isLikelyTruncatedOpenUi,
  normalizeOpenUiResponse,
} from "./normalize-openui-response";
import { looksLikeOpenUiLang } from "./is-openui-lang";

describe("ensureOpenUiRootAssignment", () => {
  it("prepends root = for bare ComponentName calls", () => {
    expect(ensureOpenUiRootAssignment('SetupCard("hi", "chatting")')).toBe('root = SetupCard("hi", "chatting")');
  });

  it("leaves existing root = statements alone", () => {
    expect(ensureOpenUiRootAssignment('root = StatCard("Leads", "42")')).toBe('root = StatCard("Leads", "42")');
  });
});

describe("extractOpenUiStatement", () => {
  it("slices past a prose preamble to the component call", () => {
    expect(extractOpenUiStatement('Sure!\nSetupCard("hi", "chatting")')).toBe('SetupCard("hi", "chatting")');
  });

  it("slices past a prose preamble to a non-SetupCard component call", () => {
    expect(extractOpenUiStatement('Sure!\nOpportunityCard("Priya", "NEW_BRIEF", "HOT")')).toBe(
      'OpportunityCard("Priya", "NEW_BRIEF", "HOT")',
    );
  });

  it("preserves Query bindings before root = (official Generate→Execute programs)", () => {
    const raw =
      'Here you go:\nopps = Query("list_opportunities", {}, [])\nroot = OpportunityList(opps)';
    expect(extractOpenUiStatement(raw)).toBe(
      'opps = Query("list_opportunities", {}, [])\nroot = OpportunityList(opps)',
    );
  });
});

describe("ensureOpportunityListQueryBinding via normalizeOpenUiResponse", () => {
  it("injects Query when OpportunityList(opps) is unbound", () => {
    expect(normalizeOpenUiResponse("root = OpportunityList(opps)")).toBe(
      'root = OpportunityList(opps)\nopps = Query("list_opportunities", {}, [])',
    );
  });

  it("hoists inline @Query inside OpportunityList (Bifrost inline-reserved shape)", () => {
    const raw = 'root = OpportunityList(@Query("list_opportunities", {}, []))';
    const normalized = normalizeOpenUiResponse(raw);
    expect(normalized).toBe(
      'root = OpportunityList(opps)\nopps = Query("list_opportunities", {}, [])',
    );
    const result = createParser(platformLibrary.toJSONSchema()).parse(normalized);
    expect(result.meta.errors).toEqual([]);
    expect((result.root as { typeName: string; hasDynamicProps?: boolean }).typeName).toBe(
      "OpportunityList",
    );
    expect((result.root as { hasDynamicProps?: boolean }).hasDynamicProps).toBe(true);
  });

  it("hoists inline Query without @ prefix", () => {
    expect(normalizeOpenUiResponse('OpportunityList(Query("search_opportunities", {query: "Priya"}, []))')).toBe(
      'root = OpportunityList(opps)\nopps = Query("search_opportunities", {query: "Priya"}, [])',
    );
  });

  it("hoists after named opportunities=@Query (Bifrost kwarg → inline-reserved path)", () => {
    const raw = 'root = OpportunityList(opportunities=@Query("list_opportunities", {}, []))';
    const normalized = normalizeOpenUiResponse(raw);
    expect(normalized).toBe(
      'root = OpportunityList(opps)\nopps = Query("list_opportunities", {}, [])',
    );
    const result = createParser(platformLibrary.toJSONSchema()).parse(normalized);
    expect(result.meta.errors).toEqual([]);
    expect((result.root as { hasDynamicProps?: boolean }).hasDynamicProps).toBe(true);
  });
});

describe("isLikelyTruncatedOpenUi", () => {
  it("detects unbalanced parentheses from a maxTokens cutoff", () => {
    expect(isLikelyTruncatedOpenUi('root = SetupCard("hi", "chatting", [{"text": "a"')).toBe(true);
  });

  it("returns false for a well-formed statement", () => {
    expect(isLikelyTruncatedOpenUi('root = SetupCard("hi", "chatting")')).toBe(false);
  });
});

describe("normalizeOpenUiResponse", () => {
  it("coerces bare named-arg SetupCard into a parseable root statement", () => {
    const raw =
      'SetupCard(assistantReply: "Let\'s get your campaign set up!", status: "ready", corridor: "Whitefield", dailyBudgetInr: 1000, adGroupName: "Sample", keywords: [], headlines: ["H1"], descriptions: ["D1"], finalUrl: "https://example.com")';
    const normalized = normalizeOpenUiResponse(raw);
    expect(looksLikeOpenUiLang(normalized)).toBe(true);
    const result = createParser(platformLibrary.toJSONSchema()).parse(normalized);
    expect(result.root).toBeTruthy();
    expect((result.root as { typeName: string }).typeName).toBe("SetupCard");
    expect(result.meta.errors).toEqual([]);
  });

  it("coerces preamble + mixed kwargs into a parseable SetupCard", () => {
    const raw =
      'Here you go:\nSetupCard("Proposed copy.", "chatting", headlines=["H1","H2","H3"], descriptions=["D1 under ninety chars.","D2 under ninety chars."])';
    const normalized = normalizeOpenUiResponse(raw);
    expect(normalized.startsWith("root = SetupCard(")).toBe(true);
    expect(normalized).not.toContain("headlines=");
    const result = createParser(platformLibrary.toJSONSchema()).parse(normalized);
    expect(result.root).toBeTruthy();
    expect(result.meta.errors).toEqual([]);
  });

  it("coerces CRM OpportunityCard named kwargs into positional OpenUI Lang", () => {
    const raw =
      'OpportunityCard(name="Priya Sharma", stage="NEW_BRIEF", tier="HOT", amountLabel="₹50k", maskedPhone="+91 ****1234", source="Google Ads")';
    const normalized = normalizeOpenUiResponse(raw);
    expect(normalized).toBe(
      'root = OpportunityCard("Priya Sharma", "NEW_BRIEF", "HOT", "₹50k", "+91 ****1234", "Google Ads")',
    );
    const result = createParser(platformLibrary.toJSONSchema()).parse(normalized);
    expect((result.root as { typeName: string }).typeName).toBe("OpportunityCard");
    expect(result.meta.errors).toEqual([]);
  });

  it("coerces StageChangeConfirm named kwargs (any key order)", () => {
    const raw =
      'root = StageChangeConfirm(opportunityName="Priya", fromStage="NEW_BRIEF", toStage="TOUR_SCHEDULED", opportunityId="abc")';
    const normalized = normalizeOpenUiResponse(raw);
    expect(normalized).toBe('root = StageChangeConfirm("abc", "Priya", "NEW_BRIEF", "TOUR_SCHEDULED")');
    const result = createParser(platformLibrary.toJSONSchema()).parse(normalized);
    expect((result.root as { typeName: string }).typeName).toBe("StageChangeConfirm");
    expect(result.meta.errors).toEqual([]);
  });

  it("coerces OpportunityList named opportunities kwarg", () => {
    const raw = 'OpportunityList(opportunities=[{name: "A", stage: "NEW_BRIEF", tier: "HOT"}])';
    const normalized = normalizeOpenUiResponse(raw);
    expect(normalized).toBe('root = OpportunityList([{name: "A", stage: "NEW_BRIEF", tier: "HOT"}])');
    const result = createParser(platformLibrary.toJSONSchema()).parse(normalized);
    expect((result.root as { typeName: string }).typeName).toBe("OpportunityList");
    expect(result.meta.errors).toEqual([]);
  });

  it("does NOT unwrap an invented Root() — that malformed-call rescue moved to prompts", () => {
    // This raw text has two real bugs: an invented Root() wrapper (no such component in any
    // library) and a malformed @Each call (get_spend_cpl_trend(7) invoked as a bare function
    // instead of bound via Query() first). @Each itself is real, spec-supported syntax — see
    // normalize-openui-response.ts's file comment — so this module only stops rescuing the
    // Root() wrapper; it never coerced @Each's *syntax* and still doesn't.
    const raw = `root = Root(
    TrendChart(
        "CPL Trend This Week",
        @Each(get_spend_cpl_trend(7).spend_cpl_trend, "day", { label: day.date, value: day.cpl })
    )
)`;
    const normalized = normalizeOpenUiResponse(raw);
    // Left as-is: no Root() unwrap. The real createParser will report an unknown-component
    // error for "Root" — that is now a client Renderer onError case (surfaced inline), not a
    // server-side rejection. The actual fix for a model producing this shape is Task 2's
    // toolExamples, which show the correct pattern: bind the tool via Query() first, then
    // reshape with a syntactically valid @Each, with no Root() wrapper at all.
    expect(normalized).toContain("root = Root(");
  });
});
