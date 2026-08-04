import { NextResponse } from "next/server";
import { listMembers, listPendingUsers, upsertMembership, INTERNAL_ORG_ID } from "@/lib/db/org-members";
import type { MemberRole } from "@/lib/types";

const VALID_ROLES: MemberRole[] = ["admin", "operator", "viewer"];

function isAuthorized(req: Request): boolean {
  const provided = req.headers.get("x-internal-api-key");
  const expected = process.env.INTERNAL_API_KEY;
  return Boolean(expected) && provided === expected;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [members, pending] = await Promise.all([listMembers(INTERNAL_ORG_ID), listPendingUsers()]);
  return NextResponse.json({ members, pending });
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json()) as { userId?: unknown; role?: unknown };
  if (typeof body.userId !== "string" || !body.userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (typeof body.role !== "string" || !VALID_ROLES.includes(body.role as MemberRole)) {
    return NextResponse.json({ error: "role must be one of admin, operator, viewer" }, { status: 400 });
  }
  await upsertMembership({
    orgId: INTERNAL_ORG_ID,
    userId: body.userId,
    role: body.role as MemberRole,
    invitedBy: null,
  });
  return NextResponse.json({ ok: true });
}
