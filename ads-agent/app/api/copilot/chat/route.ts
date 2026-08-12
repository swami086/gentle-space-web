import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { draftCopilotReply, type CopilotMessage } from "@/lib/decision-engine/copilot-chat";

export async function POST(req: Request) {
  const access = await guard("operator");
  if (!access.ok) return access.response;

  const { content, history } = (await req.json()) as { content: string; history?: CopilotMessage[] };
  if (!content?.trim()) return NextResponse.json({ error: "content is required" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      try {
        let reply = "";
        for await (const event of draftCopilotReply({ history: history ?? [], userMessage: content })) {
          if (event.type === "delta") send({ delta: event.content });
          else reply = event.reply;
        }
        send({ done: true, reply });
      } catch (err) {
        send({ done: true, error: err instanceof Error ? err.message : "internal error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
