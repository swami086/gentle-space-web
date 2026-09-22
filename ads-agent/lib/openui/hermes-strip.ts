/**
 * Pure Hermes reply text hygiene — safe to import from RSC/API routes.
 * Keep React/OpenUI library wiring in hermes-library.ts (client-only).
 */

/** Drop named kwargs inside calls: `TrendChart("t", points=[...])` → positional. */
function stripNamedKwargs(text: string): string {
  return text.replace(/([(,]\s*)[a-zA-Z_]\w*\s*=\s*(?!=)/g, "$1");
}

/**
 * Hermes often streams step headers + thinking prose before the real answer.
 * Keep text after the last bold header; prefer the last `root =` statement;
 * for plain prose with blank-line paragraphs, keep a short final paragraph.
 */
export function stripHermesStepNarration(text: string): string {
  // Header spans are usually a short noun phrase ("**Finding Ad Spend Trends**") but Hermes
  // sometimes writes a full sentence as the "header" instead — cap generously (200 chars) rather
  // than assuming they're short, since an unmatched header leaves the whole wall of text intact.
  const headers = [...text.matchAll(/\*\*[^*\n]{2,200}\*\*/g)];
  const last = headers[headers.length - 1];
  const afterHeader = last ? text.slice(last.index! + last[0].length).trim() : text;
  const result = afterHeader || text.trim();

  const rootStatements = [...result.matchAll(/root\s*=\s*[A-Z]\w*\s*\(/g)];
  const lastRoot = rootStatements[rootStatements.length - 1];
  const withoutLeadingProse = lastRoot && lastRoot.index! > 0 ? result.slice(lastRoot.index!).trim() : result;
  if (!rootStatements.length) {
    const paragraphs = withoutLeadingProse
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    if (paragraphs.length >= 2) {
      const lastParagraph = paragraphs[paragraphs.length - 1]!;
      if (lastParagraph.length <= 200 && lastParagraph.length < withoutLeadingProse.length / 2) {
        return stripNamedKwargs(lastParagraph);
      }
    }
  }

  return stripNamedKwargs(withoutLeadingProse);
}
