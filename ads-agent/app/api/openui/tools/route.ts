import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { platformToolProvider } from "@/lib/openui/platform-tools";

/** Server executor for OpenUI Query()/Mutation() from client Renderers. */
export async function POST(req: Request) {
  const access = await guard("operator");
  if (!access.ok) return access.response;

  const body = (await req.json()) as { name?: string; args?: Record<string, unknown> };
  const name = body.name?.trim();
  if (!name || !(name in platformToolProvider)) {
    return NextResponse.json(
      { error: `unknown tool "${name ?? ""}"; registered: ${Object.keys(platformToolProvider).join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const result = await platformToolProvider[name](body.args ?? {});
    return NextResponse.json(result ?? null);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "tool execution failed" },
      { status: 500 },
    );
  }
}
