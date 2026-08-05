/**
 * OpenUI Lang is positional-only (Zod key order). LLMs still emit
 * `Component(name="…", …)` / `Component(name: …)`. Rewrite named (or colon-style)
 * args to positional before createParser — schema key-order driven.
 *
 * Spec: https://www.openui.com/docs/openui-lang/specification-v05#core-rules
 */

export type ComponentPropSpec = {
  keys: readonly string[];
  defaults: Readonly<Record<string, string>>;
};

export const DEFAULT_FINAL_URL = "https://www.gentlespacesolutions.com/spaces";

/** Must stay in sync with each defineComponent Zod object key order. */
export const OPENUI_COMPONENT_PROP_SPECS: Record<string, ComponentPropSpec> = {
  SetupCard: {
    keys: [
      "assistantReply",
      "status",
      "corridor",
      "dailyBudgetInr",
      "adGroupName",
      "keywords",
      "headlines",
      "descriptions",
      "finalUrl",
    ],
    defaults: {
      assistantReply: '""',
      status: '"chatting"',
      corridor: '""',
      dailyBudgetInr: "0",
      adGroupName: '""',
      keywords: "[]",
      headlines: "[]",
      descriptions: "[]",
      finalUrl: JSON.stringify(DEFAULT_FINAL_URL),
    },
  },
  OpportunityCard: {
    keys: ["name", "stage", "tier", "amountLabel", "maskedPhone", "source"],
    defaults: {
      name: '""',
      stage: '""',
      tier: '"UNSCORED"',
      amountLabel: '""',
      maskedPhone: '""',
      source: '""',
    },
  },
  OpportunityList: {
    keys: ["opportunities"],
    defaults: { opportunities: "[]" },
  },
  StageChangeConfirm: {
    keys: ["opportunityId", "opportunityName", "fromStage", "toStage"],
    defaults: {
      opportunityId: '""',
      opportunityName: '""',
      fromStage: '""',
      toStage: '""',
    },
  },
  TrendChart: {
    keys: ["title", "points"],
    defaults: { title: '""', points: "[]" },
  },
  DataTable: {
    keys: ["headers", "rows"],
    defaults: { headers: "[]", rows: "[]" },
  },
  StatCard: {
    keys: ["label", "value", "deltaLabel", "deltaDirection"],
    defaults: {
      label: '""',
      value: '""',
      deltaLabel: '""',
      deltaDirection: '"flat"',
    },
  },
  KpiGrid: {
    keys: ["stats"],
    defaults: { stats: "[]" },
  },
  InsightCallout: {
    keys: ["headline", "supportingStat", "tone"],
    defaults: {
      headline: '""',
      supportingStat: '""',
      tone: '"neutral"',
    },
  },
  ChecklistCard: {
    keys: ["title", "items"],
    defaults: { title: '""', items: "[]" },
  },
  AlertBanner: {
    keys: ["severity", "title", "detail"],
    defaults: { severity: '"info"', title: '""', detail: '""' },
  },
  ComparisonCard: {
    keys: ["title", "leftLabel", "leftValue", "rightLabel", "rightValue"],
    defaults: {
      title: '""',
      leftLabel: '""',
      leftValue: '""',
      rightLabel: '""',
      rightValue: '""',
    },
  },
  Timeline: {
    keys: ["title", "events"],
    defaults: { title: '""', events: "[]" },
  },
  RankedList: {
    keys: ["title", "items"],
    defaults: { title: '""', items: "[]" },
  },
  BatchActionConfirm: {
    keys: ["actionLabel", "items"],
    defaults: { actionLabel: '""', items: "[]" },
  },
};

const NAMED_ARG = /^\s*([A-Za-z_][\w]*)\s*[:=]\s*([\s\S]*)$/;

export function findMatchingParen(text: string, openIdx: number): number {
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

function namedArgsToPositional(args: string[], spec: ComponentPropSpec): string | null {
  if (!looksNamed(args)) return null;

  const map = new Map<string, string>();
  let positionalIdx = 0;
  let seenNamed = false;

  for (const arg of args) {
    const m = arg.match(NAMED_ARG);
    if (m) {
      seenNamed = true;
      map.set(m[1]!, m[2]!.trim());
      continue;
    }
    // Leading positionals then named kwargs is common; positional after named is ambiguous.
    if (seenNamed) return null;
    const key = spec.keys[positionalIdx];
    if (!key) return null;
    map.set(key, arg.trim());
    positionalIdx++;
  }

  return spec.keys.map((key) => map.get(key) ?? spec.defaults[key] ?? '""').join(", ");
}

function rewriteOneComponent(text: string, name: string, spec: ComponentPropSpec): string {
  const re = new RegExp(`${name}\\s*\\(`);
  const call = text.match(re);
  if (!call || call.index === undefined) return text;

  const openParen = call.index + call[0].length - 1;
  const closeParen = findMatchingParen(text, openParen);
  if (closeParen < 0) return text;

  const inner = text.slice(openParen + 1, closeParen);
  const args = splitTopLevelArgs(inner);
  if (args.length === 0) return text;

  const rewritten = namedArgsToPositional(args, spec);
  if (rewritten === null) return text;

  return text.slice(0, openParen + 1) + rewritten + text.slice(closeParen);
}

/** Rewrite every registered `Name(kwargs)` call in `text` to positional OpenUI Lang. */
export function normalizeNamedKwargsLang(
  text: string,
  specs: Record<string, ComponentPropSpec> = OPENUI_COMPONENT_PROP_SPECS,
): string {
  let out = text;
  for (const [name, spec] of Object.entries(specs)) {
    out = rewriteOneComponent(out, name, spec);
  }
  return out;
}

export function knownOpenUiComponentNames(
  specs: Record<string, ComponentPropSpec> = OPENUI_COMPONENT_PROP_SPECS,
): string[] {
  return Object.keys(specs);
}
