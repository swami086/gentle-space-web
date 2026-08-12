import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getEnquiryById } from "@/lib/db/enquiries";
import {
  createRevision,
  upsertRequirement,
  type RequirementPatch,
} from "@/lib/db/enquiry-requirements";

function parsePatch(body: Record<string, unknown>): RequirementPatch | { error: string } {
  const patch: RequirementPatch = {};
  if (body.desksMin !== undefined) {
    const n = Number(body.desksMin);
    if (!Number.isInteger(n) || n <= 0) return { error: "desksMin must be a positive integer" };
    patch.desksMin = n;
  }
  if (body.desksMax !== undefined) {
    const n = Number(body.desksMax);
    if (!Number.isInteger(n) || n <= 0) return { error: "desksMax must be a positive integer" };
    patch.desksMax = n;
  }
  if (patch.desksMin && patch.desksMax && patch.desksMax < patch.desksMin) {
    return { error: "desksMax must be at least desksMin" };
  }
  if (body.budgetPerDeskInr !== undefined) {
    const n = Number(body.budgetPerDeskInr);
    if (!Number.isFinite(n) || n < 0) return { error: "budgetPerDeskInr must be zero or more" };
    patch.budgetPerDeskInr = n;
  }
  if (body.moveInBy !== undefined) {
    if (typeof body.moveInBy !== "string" || Number.isNaN(Date.parse(body.moveInBy))) {
      return { error: "moveInBy must be an ISO date" };
    }
    patch.moveInBy = body.moveInBy.slice(0, 10);
  }
  if (body.mustHaves !== undefined) {
    if (!Array.isArray(body.mustHaves) || body.mustHaves.some((v) => typeof v !== "string")) {
      return { error: "mustHaves must be an array of strings" };
    }
    patch.mustHaves = body.mustHaves as string[];
  }
  return patch;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope } = access;
  const { id } = await params;

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = parsePatch(raw);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (Object.keys(parsed).length === 0) {
    return NextResponse.json({ error: "no requirement fields supplied" }, { status: 400 });
  }

  if (!(await getEnquiryById(scope, id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // A manual edit is still a revision: the trail is what makes it reversible (A4).
  const [requirement] = await Promise.all([
    upsertRequirement(scope, id, parsed),
    createRevision(scope, { enquiryId: id, source: "manual", proposed: parsed }),
  ]);
  return NextResponse.json({ requirement });
}
