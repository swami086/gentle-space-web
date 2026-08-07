/** True when trimmed text is (or starts) an OpenUI Lang program.
 * Accepts `root = Name(`, bare `Name(`, and official multi-statement
 * Generate→Execute programs that begin with a Query/Mutation/$binding. */
export function looksLikeOpenUiLang(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^(?:root\s*=\s*)?[A-Z]\w*\s*\(/.test(t)) return true;
  // `opps = Query(...)\nroot = OpportunityList(opps)` — must hit Renderer + toolProvider
  return /^[a-zA-Z_$][\w$]*\s*=\s*(?:Query|Mutation)\s*\(/.test(t) || /^\$[\w]+\s*=/.test(t);
}
