export type Strategy = {
  monthlyBudgetInr: number;
  audienceSplit: { tenant: number; owner: number };
  optimizeFor: "hot_warm_leads";
  breakevenCplInr: number;
  corridors: string[];
  negativeKeywordSeeds: string[];
};

export const STRATEGY: Strategy = {
  monthlyBudgetInr: 70_000,
  audienceSplit: { tenant: 0.8, owner: 0.2 },
  optimizeFor: "hot_warm_leads",
  // PLACEHOLDER — a guessed default, not derived from real deal economics.
  // Revisit once >=30 days of real conversion data exists.
  breakevenCplInr: 2_500,
  corridors: ["whitefield", "koramangala", "hsr"],
  negativeKeywordSeeds: ["residential", "rent flat", "pg", "1bhk"],
};
