import { NextResponse } from "next/server";
import { CitationNotInPackError } from "./citation-gate";

/** Maps generative domain errors to HTTP responses; rethrows unknown errors. */
export function generativeErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof CitationNotInPackError) {
    return NextResponse.json({ error: "citation_not_in_pack" }, { status: 400 });
  }
  if (err instanceof Error && err.message === "entity_not_found") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return null;
}
