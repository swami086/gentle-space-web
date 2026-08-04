import { assertSufficientCredits } from "./metered-client";
import { debitUsage } from "./ledger";
import { computeCostUsd, creditsFromCostUsd } from "./pricing";
import type { MeteringContext } from "./types";
import type { StreamChatCompletionFn, StreamChatCompletionOptions, StreamChunk } from "../openui/streaming-types";

export async function* callMeteredStreamingChatCompletion(
  ctx: MeteringContext,
  request: StreamChatCompletionOptions,
  streamFn: StreamChatCompletionFn,
): AsyncGenerator<StreamChunk, void, unknown> {
  await assertSufficientCredits(ctx);

  let debited = false;
  for await (const chunk of streamFn(request)) {
    yield chunk;
    if (chunk.type === "usage") {
      debited = true;
      const costUsd = computeCostUsd(chunk.model, chunk.usage.promptTokens, chunk.usage.completionTokens);
      const creditsDebited = creditsFromCostUsd(costUsd);
      await debitUsage({
        orgId: ctx.orgId,
        userId: ctx.userId,
        feature: ctx.feature,
        provider: "vertex",
        model: chunk.model,
        promptTokens: chunk.usage.promptTokens,
        completionTokens: chunk.usage.completionTokens,
        totalTokens: chunk.usage.totalTokens,
        costUsd,
        creditsDebited,
        requestId: null,
      });
    }
  }

  if (!debited) {
    console.error("[metered-stream-client] stream ended without a usage chunk — no debit recorded");
  }
}
