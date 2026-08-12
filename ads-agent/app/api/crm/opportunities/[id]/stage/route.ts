import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getOpportunity, updateOpportunityStage, PIPELINE_STAGES, type PipelineStageValue } from "@/lib/crm/twenty-pipeline";
import { writeAudit } from "@/lib/db/audit-log";

const STAGE_LABELS = new Map(PIPELINE_STAGES.map((s) => [s.value, s.label] as const));

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope } = access;

  const { id } = await params;
  const { toStage, opportunityName } = (await req.json()) as { toStage?: string; opportunityName?: string };
  const label = toStage ? STAGE_LABELS.get(toStage as PipelineStageValue) : undefined;
  if (!toStage || !label) {
    return NextResponse.json(
      { error: `toStage must be one of ${PIPELINE_STAGES.map((s) => s.value).join(", ")}` },
      { status: 400 },
    );
  }

  if (scope.kind !== "platform") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const existing = await getOpportunity(scope, id);
  const previousStage = existing?.stage ?? null;

  const result = await updateOpportunityStage(scope, id, toStage as PipelineStageValue);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  await writeAudit(scope, {
    actorType: "human",
    actorUserId: access.session.userId,
    action: "opportunity.stage_changed",
    entityType: "opportunity",
    before: { stage: previousStage },
    after: { stage: toStage, opportunityName: opportunityName ?? id },
  });
  return NextResponse.json({ ok: true });
}
