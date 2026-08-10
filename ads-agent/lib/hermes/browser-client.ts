export type HermesChatOrigin = "copilot" | "crm" | "reports" | "campaign";
export type HermesStreamEvent = { delta: string } | { done: true; reply: string } | { done: true; error: string };

/**
 * Browser-side SSE consumer for the shared POST /api/hermes/chat route. Mirrors the exact
 * fetch/SSE-parsing loop already inlined in CopilotPanel/CrmAssistantPanel/ReportsChat/
 * CampaignDraftChat's own sendMessage functions, extracted once so the four panel-wiring tasks
 * (Tasks 5-8) don't each re-implement it.
 */
export async function* streamHermesChat(params: {
  origin: HermesChatOrigin;
  userMessage: string;
  history: { role: "user" | "assistant"; content: string }[];
}): AsyncGenerator<HermesStreamEvent, void, unknown> {
  const res = await fetch("/api/hermes/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userMessage: params.userMessage, history: params.history, origin: params.origin }),
  });

  if (!res.ok || !res.body) {
    yield { done: true, error: "Failed to reach Hermes" };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 2);
      if (!rawEvent.startsWith("data:")) continue;
      yield JSON.parse(rawEvent.slice("data:".length).trim()) as HermesStreamEvent;
    }
  }
}
