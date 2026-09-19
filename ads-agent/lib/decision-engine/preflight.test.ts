import { describe, expect, it } from "vitest";
import { runPreflight, type PreflightInput } from "./preflight";

function base(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    kind: "budget_change",
    payload: { campaignId: "c1", platform: "google", newDailyBudgetInr: 500 },
    orgDailyBudgetCapInr: 1000,
    creditBalance: 100,
    connectors: { googleAds: true, meta: true },
    ...overrides,
  };
}

describe("runPreflight", () => {
  describe("budget_cap", () => {
    it("blocks budget_change when proposed daily budget exceeds org cap", () => {
      const result = runPreflight(
        base({
          kind: "budget_change",
          payload: { campaignId: "c1", platform: "google", newDailyBudgetInr: 1500 },
          orgDailyBudgetCapInr: 1000,
        }),
      );
      const check = result.checks.find((c) => c.id === "budget_cap");
      expect(check).toMatchObject({ ok: false, severity: "block" });
      expect(result.ok).toBe(false);
    });

    it("passes budget_change when proposed daily budget is within cap", () => {
      const result = runPreflight(
        base({
          kind: "budget_change",
          payload: { campaignId: "c1", platform: "google", newDailyBudgetInr: 800 },
          orgDailyBudgetCapInr: 1000,
        }),
      );
      expect(result.checks.find((c) => c.id === "budget_cap")).toMatchObject({ ok: true });
      expect(result.ok).toBe(true);
    });

    it("skips budget_cap when org cap is null (unlimited)", () => {
      const result = runPreflight(
        base({
          kind: "budget_change",
          payload: { campaignId: "c1", platform: "google", newDailyBudgetInr: 999_999 },
          orgDailyBudgetCapInr: null,
        }),
      );
      expect(result.checks.find((c) => c.id === "budget_cap")).toMatchObject({ ok: true });
    });

    it("blocks create_campaign when dailyBudgetInr exceeds cap", () => {
      const result = runPreflight(
        base({
          kind: "create_campaign",
          payload: { platform: "google", dailyBudgetInr: 2000 },
          orgDailyBudgetCapInr: 1500,
        }),
      );
      expect(result.checks.find((c) => c.id === "budget_cap")).toMatchObject({
        ok: false,
        severity: "block",
      });
      expect(result.ok).toBe(false);
    });

    it("does not run budget_cap for pause", () => {
      const result = runPreflight(
        base({
          kind: "pause",
          payload: { campaignId: "c1", platform: "google" },
        }),
      );
      expect(result.checks.find((c) => c.id === "budget_cap")).toBeUndefined();
    });
  });

  describe("connector_health", () => {
    it("blocks when google mutation needs googleAds connector", () => {
      const result = runPreflight(
        base({
          kind: "budget_change",
          payload: { campaignId: "c1", platform: "google", newDailyBudgetInr: 500 },
          connectors: { googleAds: false, meta: true },
        }),
      );
      expect(result.checks.find((c) => c.id === "connector_health")).toMatchObject({
        ok: false,
        severity: "block",
      });
      expect(result.ok).toBe(false);
    });

    it("blocks when meta mutation needs meta connector", () => {
      const result = runPreflight(
        base({
          kind: "pause",
          payload: { campaignId: "c1", platform: "meta" },
          connectors: { googleAds: true, meta: false },
        }),
      );
      expect(result.checks.find((c) => c.id === "connector_health")).toMatchObject({
        ok: false,
        severity: "block",
      });
    });

    it("blocks add_negative_keyword when googleAds is unavailable", () => {
      const result = runPreflight(
        base({
          kind: "add_negative_keyword",
          payload: { campaignId: "c1", keywordText: "residential" },
          connectors: { googleAds: false, meta: true },
        }),
      );
      expect(result.checks.find((c) => c.id === "connector_health")).toMatchObject({
        ok: false,
        severity: "block",
      });
    });

    it("passes when required connector is healthy", () => {
      const result = runPreflight(
        base({
          kind: "create_campaign",
          payload: { platform: "meta", dailyBudgetInr: 500 },
          connectors: { googleAds: false, meta: true },
        }),
      );
      expect(result.checks.find((c) => c.id === "connector_health")).toMatchObject({ ok: true });
    });

    it("skips connector_health for campaign_strategy", () => {
      const result = runPreflight(
        base({
          kind: "campaign_strategy",
          payload: { summary: "test", recommendations: [] },
          connectors: { googleAds: false, meta: false },
        }),
      );
      expect(result.checks.find((c) => c.id === "connector_health")).toBeUndefined();
    });

    it("blocks google kinds when googleAds is configured but read MCP is unreachable", () => {
      const result = runPreflight(
        base({
          kind: "budget_change",
          payload: { campaignId: "c1", platform: "google", newDailyBudgetInr: 500 },
          connectors: { googleAds: true, googleAdsReachable: false, meta: true },
        }),
      );
      expect(result.checks.find((c) => c.id === "connector_health")).toMatchObject({
        ok: false,
        severity: "block",
        message: "Google Ads MCP read surface unreachable",
      });
      expect(result.ok).toBe(false);
    });

    it("passes google connector_health when googleAdsReachable is omitted", () => {
      const result = runPreflight(
        base({
          kind: "pause",
          payload: { campaignId: "c1", platform: "google" },
          connectors: { googleAds: true, meta: true },
        }),
      );
      expect(result.checks.find((c) => c.id === "connector_health")).toMatchObject({ ok: true });
    });

    it("does not apply googleAdsReachable to meta platform kinds", () => {
      const result = runPreflight(
        base({
          kind: "pause",
          payload: { campaignId: "c1", platform: "meta" },
          connectors: { googleAds: true, googleAdsReachable: false, meta: true },
        }),
      );
      expect(result.checks.find((c) => c.id === "connector_health")).toMatchObject({ ok: true });
    });
  });

  describe("credit_balance", () => {
    it("warns when credit balance is zero or negative", () => {
      const result = runPreflight(base({ creditBalance: 0 }));
      expect(result.checks.find((c) => c.id === "credit_balance")).toMatchObject({
        ok: false,
        severity: "warn",
      });
      expect(result.ok).toBe(true);
    });

    it("passes credit_balance when balance is positive", () => {
      const result = runPreflight(base({ creditBalance: 50 }));
      expect(result.checks.find((c) => c.id === "credit_balance")).toMatchObject({ ok: true });
    });
  });

  describe("keyword_overlap", () => {
    it("warns when add_negative_keyword text already exists (case-insensitive)", () => {
      const result = runPreflight(
        base({
          kind: "add_negative_keyword",
          payload: { campaignId: "c1", keywordText: "Office Space" },
          existingKeywords: ["office space", "broker"],
        }),
      );
      expect(result.checks.find((c) => c.id === "keyword_overlap")).toMatchObject({
        ok: false,
        severity: "warn",
      });
      expect(result.ok).toBe(true);
    });

    it("warns when create_campaign keyword overlaps existingKeywords", () => {
      const result = runPreflight(
        base({
          kind: "create_campaign",
          payload: {
            platform: "google",
            dailyBudgetInr: 500,
            keywords: [{ text: "Coworking", matchType: "phrase" }],
          },
          existingKeywords: ["coworking"],
        }),
      );
      expect(result.checks.find((c) => c.id === "keyword_overlap")).toMatchObject({
        ok: false,
        severity: "warn",
      });
    });

    it("passes when no keyword overlap", () => {
      const result = runPreflight(
        base({
          kind: "add_negative_keyword",
          payload: { campaignId: "c1", keywordText: "residential" },
          existingKeywords: ["office space"],
        }),
      );
      expect(result.checks.find((c) => c.id === "keyword_overlap")).toMatchObject({ ok: true });
    });

    it("does not run keyword_overlap for budget_change", () => {
      const result = runPreflight(
        base({
          kind: "budget_change",
          existingKeywords: ["office space"],
        }),
      );
      expect(result.checks.find((c) => c.id === "keyword_overlap")).toBeUndefined();
    });
  });
});
