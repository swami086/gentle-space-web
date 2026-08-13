/**
 * POST /api/generative/call-prep — operator-only enquiry call-prep (F3/F5).
 */
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { insertGenerativeAnswer } from "@/lib/db/generative-answers";
import { buildCallPrep } from "@/lib/generative/call-prep";
import { generativeErrorResponse } from "@/lib/generative/route-errors";

export async function POST(req: Request) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope, session } = access;

  const body = (await req.json()) as { enquiryId?: string };
  const enquiryId = body.enquiryId?.trim();
  if (!enquiryId) {
    return NextResponse.json({ error: "enquiryId is required" }, { status: 400 });
  }

  try {
    const result = await buildCallPrep(scope, enquiryId);
    const row = await insertGenerativeAnswer(scope, {
      surface: "call_prep",
      subjectType: "enquiry",
      subjectId: enquiryId,
      packRowIds: result.pack.rowIds,
      openuiLang: result.openuiLang,
      followUps: [],
      createdBy: session.userId,
    });

    return NextResponse.json({
      id: row.id,
      openuiLang: row.openuiLang,
      followUps: row.followUps,
      points: result.points,
    });
  } catch (err) {
    const mapped = generativeErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
