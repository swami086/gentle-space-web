/**
 * Short, rule-scoped grounding notes for the rationale-drafting LLM call.
 *
 * Distilled from the performance-marketing principles in coreyhaines31/marketingskills'
 * `ads` skill (https://github.com/coreyhaines31/marketingskills/blob/main/skills/ads/SKILL.md),
 * specifically its "Common Mistakes" and "Campaign Optimization" sections. Kept to one
 * sentence per rule — this grounds a ~150-token rationale, it isn't a playbook dump.
 */
const RULE_PLAYBOOK_CONTEXT: Record<string, string> = {
  kill_rule:
    "Ad platforms need a stable learning period, so a single bad day is noise, not signal — " +
    "but a campaign whose CPL stays meaningfully above breakeven for several consecutive " +
    "measurement windows is a genuine, evidence-backed reason to pause it.",
  budget_reallocation:
    "Shift budget toward campaigns generating a disproportionate share of Hot/Warm CRM leads " +
    "(lead quality, not just cheap clicks), and move it in ~20% steps rather than large jumps, " +
    "since big jumps reset the ad platform's delivery learning.",
  negative_keyword:
    "Search queries that generate clicks but never convert are wasted spend; blocking that exact " +
    "query pattern with a negative keyword is standard account hygiene, not a risky change.",
  manual_campaign_creation:
    "A new campaign should launch with a clear objective, budget, and audience already defined — " +
    "this proposal is a structured starting point for human review, not a live campaign.",
};

export function playbookContextFor(triggeredRule: string): string {
  return RULE_PLAYBOOK_CONTEXT[triggeredRule] ?? "";
}
