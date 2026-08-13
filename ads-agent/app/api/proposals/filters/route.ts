import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import {
  createSavedFilter,
  deleteSavedFilter,
  listSavedFilters,
  type SavedFilterQuery,
} from "@/lib/db/proposal-filters";
import type { Scope } from "@/lib/db/scope-sql";
import type { ProposalKind, ProposalStatus } from "@/lib/types";

const PROPOSAL_STATUSES = new Set<ProposalStatus>([
  "pending",
  "approved",
  "rejected",
  "executed",
  "failed",
  "scheduled",
  "executing",
]);

const PROPOSAL_KINDS = new Set<ProposalKind>([
  "create_campaign",
  "pause",
  "budget_change",
  "add_negative_keyword",
  "campaign_strategy",
]);

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "23505");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseSavedFilterQuery(raw: unknown): SavedFilterQuery | { error: string } {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "query must be an object" };
  }

  const body = raw as Record<string, unknown>;
  const query: SavedFilterQuery = {};

  if ("statuses" in body) {
    if (!isStringArray(body.statuses)) return { error: "statuses must be an array of strings" };
    if (body.statuses.some((status) => !PROPOSAL_STATUSES.has(status as ProposalStatus))) {
      return { error: "statuses contains an unknown proposal status" };
    }
    query.statuses = body.statuses;
  }

  if ("kinds" in body) {
    if (!isStringArray(body.kinds)) return { error: "kinds must be an array of strings" };
    if (body.kinds.some((kind) => !PROPOSAL_KINDS.has(kind as ProposalKind))) {
      return { error: "kinds contains an unknown proposal kind" };
    }
    query.kinds = body.kinds;
  }

  if ("orgIds" in body) {
    if (!isStringArray(body.orgIds)) return { error: "orgIds must be an array of strings" };
    query.orgIds = body.orgIds;
  }

  return query;
}

function orgIdsForbidden(scope: Scope, query: SavedFilterQuery): NextResponse | null {
  if (query.orgIds?.length && scope.kind !== "platform") {
    return NextResponse.json({ error: "orgIds requires platform staff" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const access = await guard("admin");
  if (!access.ok) return access.response;

  const filters = await listSavedFilters(access.scope, access.session.userId);
  return NextResponse.json({ filters });
}

export async function POST(req: Request) {
  const access = await guard("admin");
  if (!access.ok) return access.response;

  let body: { name?: unknown; query?: unknown };
  try {
    body = (await req.json()) as { name?: unknown; query?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
  }

  const parsedQuery = parseSavedFilterQuery(body.query);
  if ("error" in parsedQuery) {
    return NextResponse.json({ error: parsedQuery.error }, { status: 400 });
  }

  const forbidden = orgIdsForbidden(access.scope, parsedQuery);
  if (forbidden) return forbidden;

  try {
    const filter = await createSavedFilter(access.scope, access.session.userId, {
      name: body.name,
      query: parsedQuery,
    });
    return NextResponse.json({ filter }, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "filter name already exists" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(req: Request) {
  const access = await guard("admin");
  if (!access.ok) return access.response;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const deleted = await deleteSavedFilter(access.scope, access.session.userId, id);
  if (!deleted) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
