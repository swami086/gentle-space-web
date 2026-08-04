/**
 * OpenUI Lang is positional-only (Zod key order). Many LLMs still emit
 * `SetupCard(assistantReply="…", status="chatting", …)`. Rewrite named
 * (or colon-style) args to positional before parse — schema-driven, not a
 * one-off string hack.
 *
 * Spec: https://www.openui.com/docs/openui-lang/specification-v05#core-rules
 */

export const DEFAULT_FINAL_URL = "https://www.gentlespacesolutions.com/spaces";

/** SetupCard Zod key order — must stay in sync with SetupCardSchema. */
export const SETUP_CARD_PROP_KEYS = [
  "assistantReply",
  "status",
  "corridor",
  "dailyBudgetInr",
  "adGroupName",
  "keywords",
  "headlines",
  "descriptions",
  "finalUrl",
] as const;

export type SetupCardPropKey = (typeof SETUP_CARD_PROP_KEYS)[number];

const DEFAULT_EXPR: Record<SetupCardPropKey, string> = {
  assistantReply: '""',
  status: '"chatting"',
  corridor: '""',
  dailyBudgetInr: "0",
  adGroupName: '""',
  keywords: "[]",
  headlines: "[]",
  descriptions: "[]",
  finalUrl: JSON.stringify(DEFAULT_FINAL_URL),
};

const NAMED_ARG = /^\s*([A-Za-z_][\w]*)\s*[:=]\s*([\s\S]*)$/;

function findMatchingParen(text: string, openIdx: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0 && ch === ")") return i;
    }
  }
  return -1;
}

/** Split component-call args at top-level commas (strings / nests respected). */
export function splitTopLevelArgs(inner: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "(") depthParen++;
    else if (ch === ")") depthParen--;
    else if (ch === "[") depthBracket++;
    else if (ch === "]") depthBracket--;
    else if (ch === "{") depthBrace++;
    else if (ch === "}") depthBrace--;
    else if (ch === "," && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = inner.slice(start).trim();
  if (tail) args.push(tail);
  return args;
}

function looksNamed(args: string[]): boolean {
  return args.some((a) => NAMED_ARG.test(a));
}

function namedArgsToPositional(args: string[]): string | null {
  if (!looksNamed(args)) return null;

  const map = new Map<string, string>();
  for (const arg of args) {
    const m = arg.match(NAMED_ARG);
    if (!m) {
      // Mixed positional+named — refuse rather than guess
      return null;
    }
    map.set(m[1]!, m[2]!.trim());
  }

  const positional = SETUP_CARD_PROP_KEYS.map((key) => map.get(key) ?? DEFAULT_EXPR[key]);
  return positional.join(", ");
}

/**
 * If `text` contains `SetupCard(name=…)` / `SetupCard(name: …)`, rewrite to
 * positional OpenUI Lang. Leaves already-positional calls unchanged.
 */
export function normalizeSetupCardLang(text: string): string {
  const call = text.match(/SetupCard\s*\(/);
  if (!call || call.index === undefined) return text;

  const openParen = call.index + call[0].length - 1;
  const closeParen = findMatchingParen(text, openParen);
  if (closeParen < 0) return text;

  const inner = text.slice(openParen + 1, closeParen);
  const args = splitTopLevelArgs(inner);
  if (args.length === 0) return text;

  const rewritten = namedArgsToPositional(args);
  if (rewritten === null) return text;

  return text.slice(0, openParen + 1) + rewritten + text.slice(closeParen);
}
