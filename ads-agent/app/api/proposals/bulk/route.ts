import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { partitionBulkIds, type BulkItemResult } from "@/lib/decision-engine/bulk-decide";
import { getOrgSettings } from "@/lib/db/org-settings";
import { decideProposal, getProposalById, scheduleProposal } from "@/lib/db/proposals";

type BulkBody = { action?: unknown; ids?: unknown };

function normalizeIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((id) => (typeof id === "string" ? id.toLowerCase() : ""));
}

export async function POST(req: Request) {
  const access = await guard("operator");
  if (!access.ok) return access.response;

  let body: BulkBody;
  try {
    body = (await req.json()) as BulkBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
  }

  const normalized = normalizeIds(body.ids);
  if (normalized === null || normalized.some((id) => !id)) {
    return NextResponse.json({ error: "ids must be an array of strings" }, { status: 400 });
  }

  const partitioned = partitionBulkIds(normalized);
  if ("error" in partitioned) {
    return NextResponse.json({ error: partitioned.error }, { status: 400 });
  }

  const { scope } = access;
  const userId = access.session.userId;
  const results: BulkItemResult[] = [];
  const batchId = body.action === "approve" ? randomUUID() : null;

  let undoWindowSeconds = 0;
  if (body.action === "approve") {
    undoWindowSeconds = (await getOrgSettings(scope)).undoWindowSeconds;
  }

  for (const id of partitioned.ok) {
    try {
      const proposal = await getProposalById(scope, id);
      if (!proposal) {
        results.push({ id, ok: false, error: "not found" });
        continue;
      }
      if (proposal.status !== "pending") {
        results.push({ id, ok: false, error: `proposal is ${proposal.status}, not pending` });
        continue;
      }

      if (body.action === "approve") {
        const scheduled = await scheduleProposal(scope, id, {
          decidedBy: userId,
          decidedVia: "bulk",
          undoWindowSeconds,
          batchId,
        });
        if (!scheduled) {
          results.push({ id, ok: false, error: "could not schedule" });
          continue;
        }
        results.push({ id, ok: true, status: "scheduled" });
      } else {
        await decideProposal(scope, id, "rejected", userId, "bulk");
        results.push({ id, ok: true, status: "rejected" });
      }
    } catch (err) {
      results.push({
        id,
        ok: false,
        error: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  return NextResponse.json({ batchId, results });
}
