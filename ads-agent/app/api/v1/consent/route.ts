import { z } from "zod";
import type { Scope } from "@/lib/db/scope-sql";
import { originAllowed, PLATFORM_SCOPE, resolveIngestKey } from "@/lib/portal/config";
import { recordConsent } from "@/lib/portal/consent";
import { PURPOSES } from "@/lib/portal/taxonomy";

export const runtime = "nodejs";

const bodySchema = z.object({
  ingest_key: z.string().min(8).max(128),
  session_id: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  purposes: z.array(z.enum(PURPOSES)).min(1).max(PURPOSES.length),
  action: z.enum(["granted", "withdrawn"]),
  mechanism: z.enum(["banner", "form", "consent_manager"]),
});

function cors(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const headers = cors(origin);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400, headers });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "invalid_shape" }, { status: 400, headers });

  const config = await resolveIngestKey(PLATFORM_SCOPE, parsed.data.ingest_key);
  if (!config) return Response.json({ error: "unknown_key" }, { status: 404, headers });
  if (!originAllowed(origin, config.allowedOrigins)) {
    return Response.json({ error: "origin_not_allowed" }, { status: 403, headers });
  }

  // A broker cannot obtain consent for a purpose their notice never offered.
  const offered = parsed.data.purposes.every((p) => config.purposesOffered.includes(p));
  if (!offered) return Response.json({ error: "purpose_not_offered" }, { status: 400, headers });

  const scope: Scope = { kind: "org", orgId: config.orgId };
  const consentId = await recordConsent(scope, {
    subjectRef: parsed.data.session_id,
    purposes: parsed.data.purposes,
    action: parsed.data.action,
    // The version shown is the tenant's current one, taken server-side: a client
    // claiming it saw notice version 1 is not evidence of anything.
    noticeVersion: config.noticeVersion,
    mechanism: parsed.data.mechanism,
  });

  return Response.json({ consent_id: consentId }, { status: 202, headers });
}
