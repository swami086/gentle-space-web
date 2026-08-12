import { NextResponse } from "next/server";
import { newSessionId, readSessionId, sessionCookie } from "../../../../lib/portal/session";

export const runtime = "nodejs";

const PURPOSES = ["site_analytics", "space_recommendation", "enquiry_handling"];
const ACTIONS = ["granted", "withdrawn"];

export async function POST(req: Request): Promise<Response> {
  let body: { purposes?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const purposes = Array.isArray(body.purposes) ? body.purposes : [];
  const action = typeof body.action === "string" ? body.action : "";
  if (purposes.length === 0 || !purposes.every((p) => typeof p === "string" && PURPOSES.includes(p))) {
    return NextResponse.json({ error: "invalid purposes" }, { status: 400 });
  }
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "invalid action" }, { status: 400 });

  const existing = readSessionId(req.headers.get("cookie"));
  const sessionId = existing ?? newSessionId();

  const upstream = await fetch(`${process.env.PORTAL_INGEST_ORIGIN}/api/v1/consent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "",
    },
    body: JSON.stringify({
      ingest_key: process.env.GENTLE_SPACE_INGEST_KEY,
      session_id: sessionId,
      purposes,
      action,
      mechanism: "banner",
    }),
  });

  const payload = await upstream.json().catch(() => ({}));
  const res = NextResponse.json(payload, { status: upstream.status });
  if (!existing) res.headers.set("Set-Cookie", sessionCookie(sessionId));
  return res;
}
