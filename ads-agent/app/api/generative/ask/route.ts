/**
 * POST /api/generative/ask — operator-only Ask generation (F5).
 * Optional subjectType/subjectId loads a grounding pack; scope from guard().
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
  draftAskAnswer,
  isGenerativeSubjectType,
  type GenerativeSubjectType,
} from "@/lib/generative/surface-draft";

export async function POST(req: Request) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope, session } = access;

  const body = (await req.json()) as {
    question?: string;
    subjectType?: string;
    subjectId?: string;
  };
  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const hasType = Boolean(body.subjectType?.trim());
  const hasId = Boolean(body.subjectId?.trim());
  if (hasType !== hasId) {
    return NextResponse.json(
      { error: "subjectType and subjectId must both be set or both omitted" },
      { status: 400 },
    );
  }

  let subjectType: GenerativeSubjectType | undefined;
  if (hasType) {
    const raw = body.subjectType!.trim();
    if (!isGenerativeSubjectType(raw)) {
      return NextResponse.json({ error: "invalid subjectType" }, { status: 400 });
    }
    subjectType = raw;
  }

  try {
    const pack =
      subjectType && body.subjectId
        ? await buildGroundingPack(scope, subjectType, body.subjectId.trim())
        : undefined;

    const draft = draftAskAnswer(question, pack);
    if (pack) {
      const claimIds = [
        ...new Set([...draft.citationIds, ...extractClaimIdsFromOpenUi(draft.openuiLang)]),
      ];
      assertCitationsAllowed(pack, claimIds);
    }

    const row = await insertGenerativeAnswer(scope, {
      surface: "ask",
      subjectType: subjectType ?? "general",
      subjectId: body.subjectId?.trim() ?? question.slice(0, 120),
      packRowIds: pack?.rowIds ?? [],
      openuiLang: draft.openuiLang,
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
