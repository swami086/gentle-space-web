import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { revealContact } from "@/lib/db/contact-reveal";

/**
 * POST rather than GET, deliberately: this is an audited, non-idempotent act
 * from a compliance point of view, and it must not be cached, prefetched or
 * retried by a browser on the broker's behalf.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope, session } = access;
  const { id } = await params;

  const contact = await revealContact(scope, id, session.userId);
  if (!contact) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ contact }, { headers: { "Cache-Control": "no-store" } });
}
