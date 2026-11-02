import { verifyWhatsAppHubChallenge, verifyWhatsAppSignature } from "../../../../lib/inbound/whatsapp-verify";
import { platformOrgScope } from "../../../../lib/inbound/platform-scope";
import { routeInbound, type InboundRouteResult } from "../../../../lib/inbound/router";
import { withTenantTransaction } from "../../../../lib/db/tx";
import { insertInboundEvent } from "../../../../lib/db/inbound-events";

export const runtime = "nodejs";

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export async function GET(req: Request): Promise<Response> {
  const verifyToken = getRequiredEnv("WHATSAPP_VERIFY_TOKEN");
  const params = new URL(req.url).searchParams;
  const challenge = verifyWhatsAppHubChallenge(params, verifyToken);
  if (!challenge) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(req: Request): Promise<Response> {
  const appSecret = getRequiredEnv("WHATSAPP_APP_SECRET");
  const signature = req.headers.get("x-hub-signature-256");
  const bodyText = await req.text();

  const valid = verifyWhatsAppSignature(bodyText, signature, appSecret);
  if (!valid) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    // ponytail: invalid JSON after verify is a no-op; Meta must still get 200
    return Response.json({ ok: true });
  }

  const events = extractWhatsAppMessageEvents(payload);
  const routedActions: InboundRouteResult[] = [];
  if (events.length > 0) {
    const scope = platformOrgScope();
    await withTenantTransaction(scope, async (client) => {
      for (const event of events) {
        await insertInboundEvent(scope, client, {
          channel: "whatsapp",
          externalId: event.externalId,
          payload: event.payload,
        });
        const text = extractWhatsAppMessageText(event.payload);
        if (text !== null) {
          const action = routeInbound({ orgId: scope.orgId, text });
          console.log("inbound whatsapp route", {
            orgId: scope.orgId,
            externalId: event.externalId,
            action,
          });
          if (action.action !== "ignore") {
            routedActions.push(action);
          }
        }
      }
    });
  }

  if (routedActions.length > 0) {
    return Response.json({ ok: true, actions: routedActions });
  }
  return Response.json({ ok: true });
}

type WhatsAppMessageEvent = {
  externalId: string;
  payload: Record<string, unknown>;
};

function extractWhatsAppMessageEvents(payload: unknown): WhatsAppMessageEvent[] {
  const root = payload as any;
  const events: WhatsAppMessageEvent[] = [];

  if (!root || typeof root !== "object") return events;

  const entries = Array.isArray(root.entry) ? root.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      for (const message of messages) {
        const id = message?.id;
        if (typeof id === "string" && id.length > 0) {
          events.push({
            externalId: id,
            payload: message as Record<string, unknown>,
          });
        }
      }
    }
  }

  return events;
}

function extractWhatsAppMessageText(payload: Record<string, unknown>): string | null {
  const text = payload.text;
  if (!text || typeof text !== "object") return null;
  const body = (text as { body?: unknown }).body;
  return typeof body === "string" ? body : null;
}

