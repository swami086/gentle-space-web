import { timingSafeEqual } from "node:crypto";
import { mintTaskToken } from "@/mcp/context-server/task-token";
import {
  LEADS_PROFILE,
  LEADS_TOOL_ALLOWLIST,
  assertLeadsProfile,
  clampLeadsTtl,
} from "@/lib/agent/leads-tools";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authorized(req: Request): boolean {
  const expected = process.env.AGENT_INTERNAL_API_KEY;
  const got = req.headers.get("x-agent-internal-key");
  if (!expected || !got) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const { orgId, taskId, profile, ttlSeconds } = body as Record<string, unknown>;

  if (typeof orgId !== "string" || !UUID_RE.test(orgId)) {
    return Response.json({ error: "invalid_org_id" }, { status: 400 });
  }
  if (typeof taskId !== "string" || taskId.length < 1 || taskId.length > 200) {
    return Response.json({ error: "invalid_task_id" }, { status: 400 });
  }
  if (typeof profile !== "string") {
    return Response.json({ error: "invalid_profile" }, { status: 400 });
  }
  try {
    assertLeadsProfile(profile);
  } catch {
    return Response.json({ error: "forbidden_profile" }, { status: 403 });
  }

  const ttl =
    ttlSeconds === undefined
      ? clampLeadsTtl(undefined)
      : typeof ttlSeconds === "number"
        ? clampLeadsTtl(ttlSeconds)
        : null;
  if (ttl === null) {
    return Response.json({ error: "invalid_ttl" }, { status: 400 });
  }

  try {
    const { token } = await mintTaskToken({
      orgId,
      taskId,
      profile: LEADS_PROFILE,
      toolAllowlist: [...LEADS_TOOL_ALLOWLIST],
      ttlSeconds: ttl,
    });
    return Response.json({ token });
  } catch {
    return Response.json({ error: "mint_failed" }, { status: 500 });
  }
}
