/**
 * Citation allowlist enforcement for generative surfaces (F4).
 *
 * OpenUI Lang citation convention (see generative-library.ts):
 *   - cite("row-id") — inline single citation in prose components
 *   - citationIds(["id-a", "id-b"]) — positional prop on WhyCard / ActionProposal
 *   - citationIds: ["id-a"] — object field inside CallPrepCard point literals
 */
import { stripSmuggle } from "../decision-engine/strip-smuggle";
import type { GenerativeGroundingPack } from "./grounding-pack";

export class CitationNotInPackError extends Error {
  constructor(readonly citationId: string) {
    super("citation_not_in_pack");
    this.name = "CitationNotInPackError";
  }
}

export function assertCitationsAllowed(
  pack: GenerativeGroundingPack,
  citationIds: string[],
): void {
  const allowed = new Set(pack.rowIds.map((id) => stripSmuggle(id)));
  for (const raw of citationIds) {
    const id = stripSmuggle(raw);
    if (!id) continue;
    if (!allowed.has(id)) throw new CitationNotInPackError(id);
  }
}

const CITE_RE = /cite\s*\(\s*["']([^"']+)["']\s*\)/g;
const CITATION_IDS_CALL_RE = /citationIds\s*\(\s*\[(.*?)\]\s*\)/gs;
const CITATION_IDS_FIELD_RE = /citationIds\s*:\s*\[(.*?)\]/gs;
const QUOTED_STRING_RE = /["']([^"']+)["']/g;

function quotedIdsFromArrayLiteral(inner: string): string[] {
  return [...inner.matchAll(QUOTED_STRING_RE)].map((m) => stripSmuggle(m[1]));
}

/** Collects every citation id embedded in a generative OpenUI Lang string. */
export function extractClaimIdsFromOpenUi(openuiLang: string): string[] {
  const ids: string[] = [];

  for (const match of openuiLang.matchAll(CITATION_IDS_CALL_RE)) {
    ids.push(...quotedIdsFromArrayLiteral(match[1]));
  }

  for (const match of openuiLang.matchAll(CITATION_IDS_FIELD_RE)) {
    ids.push(...quotedIdsFromArrayLiteral(match[1]));
  }

  for (const match of openuiLang.matchAll(CITE_RE)) {
    ids.push(stripSmuggle(match[1]));
  }

  return ids;
}
