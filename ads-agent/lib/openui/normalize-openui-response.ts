/**
 * OpenUI Lang statements should be `root = ComponentName(...)`. Models often omit `root =`
 * and/or emit named kwargs — coerce before createParser. This is a non-blocking hygiene pass:
 * every caller streams the result through regardless of whether it ends up fully valid — the
 * client Renderer (with its toolProvider) is what actually parses and executes Query()/Mutation().
 * Campaign draft chat is the one exception that still hard-parses server-side (it persists
 * fields to the campaign_drafts DB row) — see campaign-library.ts's parseSetupCardResponse.
 *
 * Official Generate→Execute programs use object Query results + field pluck:
 *   root = OpportunityList(list.opportunities)
 *   list = Query("list_opportunities", {}, {opportunities: []})
 * Never strip Query/Mutation/$bindings when slicing past prose — that left CRM chat with unbound
 * OpportunityList and empty UI. See https://www.openui.com/docs/openui-lang/how-it-works
 * and https://www.openui.com/docs/openui-lang/queries-mutations
 */
import { knownOpenUiComponentNames, normalizeNamedKwargsLang, findMatchingParen } from "./normalize-named-kwargs";

/** Drop a single outer markdown fence if the whole response is wrapped. */
export function stripOuterMarkdownFence(text: string): string {
  const m = text.trim().match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1]!.trim() : text.trim();
}

/**
 * Models sometimes emit a short prose preamble before the OpenUI program
 * ("Sure!\nSetupCard(...)" or "Sure!\nopps = Query(...)\nroot = ...").
 * Prefer keeping full multi-statement programs (Query/Mutation/$bindings + root).
 */
export function extractOpenUiStatement(text: string): string {
  const t = stripOuterMarkdownFence(text);
  if (!t) return t;
  if (/^root\s*=/.test(t) || /^[A-Z]\w*\s*\(/.test(t) || /^[a-zA-Z_$][\w$]*\s*=/.test(t)) return t;

  // Multi-statement: start at first Query/Mutation/$binding/root assignment
  const program = t.match(
    /(?:^|[\n\r])\s*((?:[a-zA-Z_$][\w$]*\s*=\s*(?:Query|Mutation)\s*\(|\$[\w]+\s*=|root\s*=\s*[A-Z]\w*\s*\()[\s\S]*)$/,
  );
  if (program) return program[1]!.trim();

  const rootMatch = t.match(/(?:^|[\n\r])\s*(root\s*=\s*[A-Z]\w*\s*\([\s\S]*)$/);
  if (rootMatch) return rootMatch[1]!.trim();

  const callMatch = t.match(/(?:^|[\n\r])\s*([A-Z]\w*\s*\([\s\S]*)$/);
  if (callMatch) return callMatch[1]!.trim();

  const names = knownOpenUiComponentNames().join("|");
  const mid = t.match(new RegExp(`(?:${names})\\s*\\(`));
  if (mid && mid.index !== undefined) return t.slice(mid.index).trim();

  return t;
}

/** Prepend `root = ` when the model emits a bare `ComponentName(` call (single-statement only). */
export function ensureOpenUiRootAssignment(text: string): string {
  const t = text.trim();
  if (!t) return t;
  if (/^root\s*=/.test(t)) return t;
  // Multi-statement programs already have bindings; don't wrap the whole block
  if (/^[a-zA-Z_$][\w$]*\s*=/.test(t) && /\n/.test(t)) return t;
  if (/^[A-Z]\w*\s*\(/.test(t)) return `root = ${t}`;
  return t;
}

const OPP_LIST_QUERY_DEFAULTS = "{opportunities: []}";

function firstRegexMatch(re: RegExp, text: string): RegExpMatchArray | null {
  return text.match(re);
}

/**
 * OpenUI requires Query as a top-level statement. Bifrost often emits
 * `root = OpportunityList(@Query("list_opportunities", {}, []))` which createParser
 * rejects with `inline-reserved`. Hoist the Query call, coerce bare-array Query defaults
 * to `{opportunities: []}`, and rewrite `OpportunityList(ident)` → `ident.opportunities`.
 *
 * Bare-array tool results + `list.opportunities` column-pluck null from every row → blank cards.
 */
export function ensureOpportunityListQueryBinding(text: string): string {
  let t = text.trim();
  if (!t) return t;

  const inline = firstRegexMatch(/((?:root\s*=\s*)?)OpportunityList\(\s*@?Query\s*\(/, t);
  if (inline && inline.index !== undefined) {
    const assignPrefix = inline[1] ?? "";
    const listStart = inline.index + assignPrefix.length;
    const listOpen = t.indexOf("(", listStart);
    const listClose = findMatchingParen(t, listOpen);
    const queryStart = listOpen >= 0 ? t.indexOf("Query(", listOpen) : -1;
    const queryOpen = queryStart >= 0 ? queryStart + "Query".length : -1;
    const queryClose = queryOpen >= 0 ? findMatchingParen(t, queryOpen) : -1;
    if (listClose >= 0 && queryClose >= 0 && queryClose < listClose) {
      const queryCall = t.slice(queryStart, queryClose + 1);
      const before = t.slice(0, inline.index);
      const after = t.slice(listClose + 1);
      // OpenUI: root first for streaming; Query binding may follow (forward refs OK).
      t = `${before}${assignPrefix}OpportunityList(list.opportunities)\nlist = ${queryCall}${after}`.trim();
    }
  }

  // Object-shaped defaults for list/search Query tools.
  t = t.replace(
    /(=\s*Query\s*\(\s*["'](?:list_opportunities|search_opportunities)["']\s*,\s*\{[\s\S]*?\}\s*,\s*)\[\s*\](\s*(?:,|\)))/g,
    `$1${OPP_LIST_QUERY_DEFAULTS}$2`,
  );

  // OpportunityList(ident) → OpportunityList(ident.opportunities) for bare Query bindings.
  t = t.replace(
    /OpportunityList\(\s*([A-Za-z_][\w]*)\s*\)/g,
    (_m, ident: string) => `OpportunityList(${ident}.opportunities)`,
  );

  if (/=\s*Query\s*\(\s*["'](?:list_opportunities|search_opportunities)["']/.test(t)) return t;

  // Only inject when OpportunityList references an unbound identifier (not an inline array/object).
  const unbound = firstRegexMatch(
    /OpportunityList\(\s*([A-Za-z_][\w]*(?:\.opportunities)?)\s*\)/,
    t,
  );
  if (!unbound) return t;

  const withRoot = /^root\s*=/.test(t) ? t : `root = ${t}`;
  const rooted = withRoot.replace(
    /OpportunityList\(\s*[A-Za-z_][\w]*(?:\.opportunities)?\s*\)/,
    "OpportunityList(list.opportunities)",
  );
  return `${rooted}\nlist = Query("list_opportunities", {}, ${OPP_LIST_QUERY_DEFAULTS})`;
}

/** True when a component call's parentheses are unbalanced (likely a maxTokens cutoff mid-stream).
 * Used by Campaign draft chat only, to ask the model for one bounded retry with a shorter card —
 * a real failure mode distinct from the parse-gate this module no longer enforces elsewhere. */
export function isLikelyTruncatedOpenUi(text: string): boolean {
  const t = text.trim();
  const open = t.search(/[A-Z]\w*\s*\(/);
  if (open < 0) return false;
  const openParen = t.indexOf("(", open);
  return findMatchingParen(t, openParen) < 0;
}

/** Coerce root assignment + named→positional rewrite for every registered OpenUI component
 * (see normalize-named-kwargs.ts's OPENUI_COMPONENT_PROP_SPECS — intentionally NOT scoped to
 * SetupCard: OpenUI Lang is positional-only per spec v0.5 core rule #6, and named kwargs on any
 * component fail the real createParser the same way SetupCard's did). This is the only transform
 * applied; callers never reject or retry based on whether the result parses cleanly afterward. */
export function normalizeOpenUiResponse(text: string): string {
  // Named kwargs first: `OpportunityList(opportunities=@Query(...))` becomes
  // `OpportunityList(@Query(...))`, which the hoist below can fix. Hoisting before
  // named→positional left that Bifrost shape as inline-reserved.
  const positional = normalizeNamedKwargsLang(ensureOpenUiRootAssignment(extractOpenUiStatement(text)));
  return ensureOpportunityListQueryBinding(positional);
}
