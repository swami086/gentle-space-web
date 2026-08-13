import { insertInboundEvent } from "@/lib/db/inbound-events";
import { withTenantTransaction } from "@/lib/db/tx";
import { platformOrgScope } from "@/lib/inbound/platform-scope";
import { verifyPostmarkBasicAuth } from "@/lib/inbound/postmark-auth";

export const runtime = "nodejs";

function getPostmarkCredentials(env: NodeJS.ProcessEnv = process.env): { user: string; pass: string } | null {
  const rawUser = env.POSTMARK_INBOUND_USER;
  const rawPass = env.POSTMARK_INBOUND_PASS;
  const user = rawUser?.trim();
  const pass = rawPass?.trim();
  if (!user || !pass) return null;
  return { user, pass };
}

export async function POST(req: Request): Promise<Response> {
  const creds = getPostmarkCredentials(process.env);
  if (!creds) {
    return Response.json({ error: "postmark_inbound_not_configured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  if (!verifyPostmarkBasicAuth(authHeader, creds.user, creds.pass)) {
    return new Response(null, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object") {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  const messageId = (payload as Record<string, unknown>).MessageID;
  if (typeof messageId !== "string" || messageId.trim() === "") {
    return Response.json({ error: "invalid_message_id" }, { status: 400 });
  }

  const scope = platformOrgScope(process.env);

  const result = await withTenantTransaction(scope, (client) =>
    insertInboundEvent(scope, client, {
      channel: "email",
      externalId: messageId,
      payload: payload as Record<string, unknown>,
    }),
  );

  return Response.json({ inserted: result.inserted }, { status: 200 });
}

