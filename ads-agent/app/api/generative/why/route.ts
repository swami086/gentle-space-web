/**
 * POST /api/generative/why — operator-only Why generation for a proposal (F5).
 * Auth matches Copilot: guard("operator"); scope from session, never client orgId.
 */
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { insertGenerativeAnswer } from "@/lib/db/generative-answers";
import {
  assertCitationsAllowed,
  extractClaimIdsFromOpenUi,
} from "@/lib/generative/citation-gate";
import { buildGroundingPack } from "@/lib/generative/grounding-pack";
import { generativeErrorResponse } from "@/lib/generative/route-errors";
import {
  formatWhyOpenUiLang,
  templateWhyFromProposalPack,
} from "@/lib/generative/surface-draft";

export async function POST(req: Request) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope, session } = access;

  const body = (await req.json()) as { proposalId?: string };
  const proposalId = body.proposalId?.trim();
  if (!proposalId) {
    return NextResponse.json({ error: "proposalId is required" }, { status: 400 });
  }

  try {
    const pack = await buildGroundingPack(scope, "proposal", proposalId);
    const draft = templateWhyFromProposalPack(pack);
    const openuiLang = formatWhyOpenUiLang(draft.body, draft.citationIds, draft.followUps);
    const claimIds = [
      ...new Set([...draft.citationIds, ...extractClaimIdsFromOpenUi(openuiLang)]),
    ];
    assertCitationsAllowed(pack, claimIds);

    const row = await insertGenerativeAnswer(scope, {
      surface: "why",
      subjectType: "proposal",
      subjectId: proposalId,
      packRowIds: pack.rowIds,
      openuiLang,
      followUps: draft.followUps,
      createdBy: session.userId,
    });

    return NextResponse.json({
      id: row.id,
      openuiLang: row.openuiLang,
      followUps: row.followUps,
    });
  } catch (err) {
    const mapped = generativeErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
