/**
 * Exhaustive OpenUI Lang regression: every registered component × Bifrost failure modes
 * must normalize + parse to a valid root (no generic "trouble structuring/putting" paths).
 *
 * Modes: bare (no root=), named kwargs (= and :), mixed leading positionals + named,
 * prose preamble, markdown fence.
 */
import { createParser } from "@openuidev/lang-core";
import { describe, expect, it } from "vitest";
import { campaignLibrary, parseSetupCardResponse } from "./campaign-library";
import { crmLibrary } from "./crm-library";
import { analyticsLibrary } from "./analytics-library";
import { platformLibrary } from "./platform-library";
import { looksLikeOpenUiLang } from "./is-openui-lang";
import { normalizeOpenUiResponse } from "./normalize-openui-response";
import { OPENUI_COMPONENT_PROP_SPECS } from "./normalize-named-kwargs";

const GENERIC_FAIL =
  /trouble (structuring|putting) that together|could you rephrase/i;

type Fixture = {
  id: string;
  surface: "campaign" | "crm" | "reports" | "copilot";
  raw: string;
  expectType: string;
};

/** Minimal valid named-arg bodies per component (Zod key order). */
const NAMED_BODIES: Record<string, string> = {
  SetupCard:
    'assistantReply="Proposed copy.", status="chatting", corridor="Whitefield", dailyBudgetInr=500, adGroupName="HSR", keywords=[], headlines=["Office Space Whitefield","Find Office Near You","Bangalore CRE Experts"], descriptions=["Find verified office space in Whitefield.","Trusted CRE consultancy for Bangalore teams."], finalUrl="https://www.gentlespacesolutions.com/spaces"',
  OpportunityCard:
    'name="Priya Sharma", stage="NEW_BRIEF", tier="HOT", amountLabel="₹50k", maskedPhone="+91 ****1234", source="Google Ads"',
  OpportunityList: 'opportunities=[{name: "Priya Sharma", stage: "NEW_BRIEF", tier: "HOT"}]',
  StageChangeConfirm:
    'opportunityId="opp-1", opportunityName="Priya Sharma", fromStage="NEW_BRIEF", toStage="SHORTLIST"',
  TrendChart: 'title="CPL trend", points=[{label: "Mon", value: 12}, {label: "Tue", value: 9}]',
  DataTable:
    'headers=["Campaign", "CPL"], rows=[{cells: ["Whitefield", "₹420"]}, {cells: ["HSR", "₹380"]}]',
  StatCard: 'label="Pipeline", value="₹12L", deltaLabel="+8%", deltaDirection="up"',
  KpiGrid: 'stats=[{label: "Leads", value: "42", deltaLabel: "", deltaDirection: "flat"}]',
  InsightCallout: 'headline="CPL improved on Search", supportingStat="−12% WoW", tone="positive"',
  ChecklistCard: 'title="Today", items=[{text: "Review Whitefield proposal", status: "pending"}]',
  AlertBanner: 'severity="warning", title="Budget pacing hot", detail="Whitefield at 90% of daily cap."',
  ComparisonCard:
    'title="This vs last week", leftLabel="This week", leftValue="₹420 CPL", rightLabel="Last week", rightValue="₹480 CPL"',
  Timeline: 'title="Lead activity", events=[{timestamp: "10:00", description: "Brief received"}]',
  RankedList: 'title="Top corridors", items=[{label: "Whitefield", value: "₹2.1L"}, {label: "HSR", value: "₹1.4L"}]',
  BatchActionConfirm:
    'actionLabel="Pause underperformers", items=[{label: "Old brand campaign", fromState: "ENABLED", toState: "PAUSED"}]',
};

/** Mixed: first 1–2 keys positional, rest named (where component has ≥2 keys). */
const MIXED_BODIES: Record<string, string> = {
  SetupCard:
    '"Proposed copy.", "chatting", headlines=["Office Space Whitefield","Find Office Near You","Bangalore CRE Experts"], descriptions=["Find verified office space in Whitefield.","Trusted CRE consultancy for Bangalore teams."]',
  OpportunityCard: '"Priya Sharma", "NEW_BRIEF", tier="HOT"',
  StageChangeConfirm: '"opp-1", "Priya Sharma", fromStage="NEW_BRIEF", toStage="SHORTLIST"',
  TrendChart: '"CPL trend", points=[{label: "Mon", value: 12}]',
  DataTable: '["Campaign", "CPL"], rows=[{cells: ["Whitefield", "₹420"]}]',
  StatCard: '"Pipeline", "₹12L", deltaDirection="up"',
  InsightCallout: '"CPL improved", tone="positive"',
  ChecklistCard: '"Today", items=[{text: "Review proposal", status: "pending"}]',
  AlertBanner: '"warning", "Budget pacing hot"',
  ComparisonCard: '"WoW", "This week", "₹420", rightLabel="Last week", rightValue="₹480"',
  Timeline: '"Activity", events=[{timestamp: "10:00", description: "Brief received"}]',
  RankedList: '"Top", items=[{label: "Whitefield", value: "₹2.1L"}]',
  BatchActionConfirm: '"Pause underperformers", items=[{label: "Old brand", fromState: "ENABLED", toState: "PAUSED"}]',
};

const SURFACE_FOR: Record<string, Fixture["surface"]> = {
  SetupCard: "campaign",
  OpportunityCard: "crm",
  OpportunityList: "crm",
  StageChangeConfirm: "crm",
  TrendChart: "reports",
  DataTable: "reports",
  StatCard: "copilot",
  KpiGrid: "copilot",
  InsightCallout: "copilot",
  ChecklistCard: "copilot",
  AlertBanner: "copilot",
  ComparisonCard: "copilot",
  Timeline: "copilot",
  RankedList: "copilot",
  BatchActionConfirm: "copilot",
};

function buildFixtures(): Fixture[] {
  const fixtures: Fixture[] = [];
  for (const name of Object.keys(OPENUI_COMPONENT_PROP_SPECS)) {
    const named = NAMED_BODIES[name];
    if (!named) throw new Error(`Missing NAMED_BODIES for ${name}`);
    const surface = SURFACE_FOR[name] ?? "copilot";
    const colonNamed = named.replace(/=/g, ": ");

    fixtures.push(
      { id: `${name}/bare-named`, surface, expectType: name, raw: `${name}(${named})` },
      { id: `${name}/root-named`, surface, expectType: name, raw: `root = ${name}(${named})` },
      { id: `${name}/colon-named`, surface, expectType: name, raw: `root = ${name}(${colonNamed})` },
      {
        id: `${name}/preamble`,
        surface,
        expectType: name,
        raw: `Sure — here you go!\n${name}(${named})`,
      },
      {
        id: `${name}/fenced`,
        surface,
        expectType: name,
        raw: "```\n" + `root = ${name}(${named})` + "\n```",
      },
    );

    const mixed = MIXED_BODIES[name];
    if (mixed) {
      fixtures.push({
        id: `${name}/mixed`,
        surface,
        expectType: name,
        raw: `root = ${name}(${mixed})`,
      });
    }
  }

  // Historical production failures
  fixtures.push(
    {
      id: "history/campaign-headlines-bare",
      surface: "campaign",
      expectType: "SetupCard",
      raw: 'SetupCard("Proposed headlines.", "chatting", "", 0, "", [], ["Office Space Whitefield","Find Office Near You","Bangalore CRE Experts"], ["Find verified office space in Whitefield.","Trusted CRE consultancy for Bangalore teams."])',
    },
    {
      id: "history/crm-stage-reordered-kwargs",
      surface: "crm",
      expectType: "StageChangeConfirm",
      raw: 'StageChangeConfirm(opportunityName="Priya", fromStage="NEW_BRIEF", toStage="TOUR_SCHEDULED", opportunityId="abc")',
    },
  );

  return fixtures;
}

function libraryFor(surface: Fixture["surface"]) {
  switch (surface) {
    case "campaign":
      return campaignLibrary;
    case "crm":
      return crmLibrary;
    case "reports":
      return analyticsLibrary;
    case "copilot":
      return platformLibrary;
  }
}

function assertParses(fixture: Fixture) {
  const normalized = normalizeOpenUiResponse(fixture.raw);
  expect(GENERIC_FAIL.test(normalized)).toBe(false);
  expect(looksLikeOpenUiLang(normalized)).toBe(true);

  if (fixture.expectType === "SetupCard") {
    const parsed = parseSetupCardResponse(fixture.raw);
    expect(parsed.kind, `${fixture.id}: ${parsed.kind === "parse_error" ? parsed.errors.join("; ") : ""}`).toBe(
      "ok",
    );
    return;
  }

  const result = createParser(libraryFor(fixture.surface).toJSONSchema()).parse(normalized);
  expect(result.root, `${fixture.id}: no root — ${JSON.stringify(result.meta.errors)}`).toBeTruthy();
  expect((result.root as { typeName: string }).typeName).toBe(fixture.expectType);
  expect(result.meta.errors, `${fixture.id}: ${JSON.stringify(result.meta.errors)}`).toEqual([]);
}

describe("OpenUI exhaustive normalize+parse regression", () => {
  const fixtures = buildFixtures();

  it("covers every registered component", () => {
    const covered = new Set(fixtures.map((f) => f.expectType));
    for (const name of Object.keys(OPENUI_COMPONENT_PROP_SPECS)) {
      expect(covered.has(name), `missing fixtures for ${name}`).toBe(true);
    }
  });

  it.each(fixtures)("$id → valid $expectType root", (fixture) => {
    assertParses(fixture);
  });

  it("campaign historical headline turn is ok via parseSetupCardResponse", () => {
    const result = parseSetupCardResponse(
      'Sure!\nSetupCard(assistantReply="Here are headlines and descriptions.", status="chatting", headlines=["H1","H2","H3"], descriptions=["D1 under ninety characters.","D2 under ninety characters."])',
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.props.headlines).toHaveLength(3);
      expect(result.props.descriptions).toHaveLength(2);
    }
  });
});
