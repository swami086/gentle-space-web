import { describe, expect, it } from "vitest";
import { brokerRationale } from "./broker-rationale";

describe("brokerRationale", () => {
  it("budget_change is numbers-forward", () => {
    expect(
      brokerRationale({
        kind: "budget_change",
        triggeredRule: "budget_reallocation",
        payload: { campaignId: "c1", newDailyBudgetInr: 1500 },
      }),
    ).toMatch(/₹\s*1,?500/);
  });

  it("pause names the action plainly", () => {
    expect(
      brokerRationale({
        kind: "pause",
        triggeredRule: "kill_rule",
        payload: { campaignId: "c1" },
      }),
    ).toMatch(/pause/i);
  });

  it("unknown kind falls back to generic copy", () => {
    expect(
      brokerRationale({
        kind: "future_kind",
        triggeredRule: "some_rule",
        payload: { foo: "bar" },
      }),
    ).toBe(
      'Rule "some_rule" triggered a "future_kind" proposal. See the payload for exact values.',
    );
  });

  it("create_campaign mentions budget and corridor", () => {
    expect(
      brokerRationale({
        kind: "create_campaign",
        triggeredRule: "manual_campaign_creation",
        payload: {
          corridor: "Bandra",
          platform: "google",
          dailyBudgetInr: 2000,
        },
      }),
    ).toMatch(/₹\s*2,?000/);
    expect(
      brokerRationale({
        kind: "create_campaign",
        triggeredRule: "manual_campaign_creation",
        payload: {
          corridor: "Bandra",
          platform: "google",
          dailyBudgetInr: 2000,
        },
      }),
    ).toMatch(/Bandra/i);
  });

  it("add_negative_keyword names the blocked term", () => {
    expect(
      brokerRationale({
        kind: "add_negative_keyword",
        triggeredRule: "negative_keyword",
        payload: { campaignId: "c1", keywordText: "free" },
      }),
    ).toMatch(/free/i);
    expect(
      brokerRationale({
        kind: "add_negative_keyword",
        triggeredRule: "negative_keyword",
        payload: { campaignId: "c1", keywordText: "free" },
      }),
    ).toMatch(/negative/i);
  });

  it("campaign_strategy leads with the summary", () => {
    expect(
      brokerRationale({
        kind: "campaign_strategy",
        triggeredRule: "strategy_review",
        payload: {
          summary: "Shift spend toward Bandra corridor",
          recommendations: [{ title: "Raise budget", rationale: "Strong CPL" }],
        },
      }),
    ).toMatch(/Shift spend toward Bandra corridor/);
  });

  it("enquiry.requirement_update names the enquiry", () => {
    expect(
      brokerRationale({
        kind: "enquiry.requirement_update",
        triggeredRule: "leads_triage",
        payload: {
          enquiry_id: "e-42",
          requirements: { minDesks: 10, corridor: "Bandra" },
        },
      }),
    ).toMatch(/e-42/);
    expect(
      brokerRationale({
        kind: "enquiry.requirement_update",
        triggeredRule: "leads_triage",
        payload: {
          enquiry_id: "e-42",
          requirements: { minDesks: 10, corridor: "Bandra" },
        },
      }),
    ).toMatch(/10.*desk/i);
  });

  it("message.draft names channel and enquiry", () => {
    expect(
      brokerRationale({
        kind: "message.draft",
        triggeredRule: "leads_triage",
        payload: {
          enquiry_id: "e-99",
          channel: "email",
          subject: "Follow-up on your space search",
        },
      }),
    ).toMatch(/email/i);
    expect(
      brokerRationale({
        kind: "message.draft",
        triggeredRule: "leads_triage",
        payload: {
          enquiry_id: "e-99",
          channel: "email",
          subject: "Follow-up on your space search",
        },
      }),
    ).toMatch(/e-99/);
  });

  it("strips invisible unicode from output", () => {
    expect(
      brokerRationale({
        kind: "pause",
        triggeredRule: "kill_rule",
        payload: { campaignId: "c\u200B1" },
      }),
    ).toBe('Pause campaign c1 (rule: kill_rule).');
  });
});
