import { NextResponse } from "next/server";
import { getJwks } from "@/lib/jwt";

export async function GET() {
  const jwks = await getJwks();
  return NextResponse.json(jwks, { headers: { "Cache-Control": "public, max-age=300" } });
}
