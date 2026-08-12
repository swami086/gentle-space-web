import { ingest } from "@/lib/portal/ingest";
import { originAllowed, PLATFORM_SCOPE, resolveIngestKey } from "@/lib/portal/config";
import { MAX_BODY_BYTES } from "@/lib/portal/taxonomy";

export const runtime = "nodejs";

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ingest-Key",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const ingestKey = req.headers.get("x-ingest-key");
  if (!ingestKey) return new Response(null, { status: 404 });
  const config = await resolveIngestKey(PLATFORM_SCOPE, ingestKey);
  if (!config || !originAllowed(origin, config.allowedOrigins)) return new Response(null, { status: 404 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const ingestKey = req.headers.get("x-ingest-key");

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413, headers: corsHeaders(origin) });
  }

  const body = await req.text();
  const outcome = await ingest({ body, ingestKey, origin });
  if (!outcome.ok) {
    return Response.json({ error: outcome.reason }, { status: outcome.status, headers: corsHeaders(origin) });
  }
  return Response.json({ accepted: outcome.accepted }, { status: 202, headers: corsHeaders(origin) });
}
