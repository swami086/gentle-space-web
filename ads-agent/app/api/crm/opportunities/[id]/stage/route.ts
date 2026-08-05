import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { updateOpportunityStage, PIPELINE_STAGES, type PipelineStageValue } from "@/lib/crm/twenty-pipeline";
import { logAiAction } from "@/lib/db/ai-action-log";

const STAGE_LABELS = new Map(PIPELINE_STAGES.map((s) => [s.value, s.label] as const));

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;

  const { id } = await params;
  const { toStage, opportunityName } = (await req.json()) as { toStage?: string; opportunityName?: string };
  const label = toStage ? STAGE_LABELS.get(toStage as PipelineStageValue) : undefined;
  if (!toStage || !label) {
    return NextResponse.json(
      { error: `toStage must be one of ${PIPELINE_STAGES.map((s) => s.value).join(", ")}` },
      { status: 400 },
    );
  }

  const result = await updateOpportunityStage(id, toStage as PipelineStageValue);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  await logAiAction({ domain: "crm", summary: `Advanced ${opportunityName ?? id} to ${label}` });
  return NextResponse.json({ ok: true });
}
