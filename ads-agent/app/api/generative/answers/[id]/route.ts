/**
 * GET /api/generative/answers/[id] — viewer read of a persisted generative answer (F5).
 */
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getGenerativeAnswer } from "@/lib/db/generative-answers";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("viewer");
  if (!access.ok) return access.response;
  const { scope } = access;
  const { id } = await params;

  const row = await getGenerativeAnswer(scope, id);
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    surface: row.surface,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    openuiLang: row.openuiLang,
    followUps: row.followUps,
    packRowIds: row.packRowIds,
    createdAt: row.createdAt,
  });
}
