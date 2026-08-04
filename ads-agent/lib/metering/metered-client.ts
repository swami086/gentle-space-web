import { chatCompletion, type ChatCompletionOptions, type ChatCompletionResponse } from "../bifrost/client";
import { getOrgBalance, getUserCap, debitUsage } from "./ledger";
import { computeCostUsd, creditsFromCostUsd } from "./pricing";
import { InsufficientCreditsError, type MeteringContext } from "./types";

export async function assertSufficientCredits(ctx: MeteringContext): Promise<void> {
  const orgBalance = await getOrgBalance(ctx.orgId);
  if (orgBalance <= 0) {
    throw new InsufficientCreditsError(`Org ${ctx.orgId} has no remaining credits`);
  }

  const userCap = await getUserCap(ctx.userId);
  if (userCap !== null && userCap <= 0) {
    throw new InsufficientCreditsError(`User ${ctx.userId} has exhausted their individual credit cap`);
  }
}

export async function callMeteredChatCompletion(
  ctx: MeteringContext,
  request: ChatCompletionOptions,
): Promise<ChatCompletionResponse> {
  await assertSufficientCredits(ctx);

  const response = await chatCompletion(request);

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  const totalTokens = response.usage?.total_tokens ?? promptTokens + completionTokens;
  const model = response.model || request.model || "unknown";
  const costUsd = computeCostUsd(model, promptTokens, completionTokens);
  const creditsDebited = creditsFromCostUsd(costUsd);

  await debitUsage({
    orgId: ctx.orgId,
    userId: ctx.userId,
    feature: ctx.feature,
    provider: "vertex",
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd,
    creditsDebited,
    requestId: response.id ?? null,
  });

  return response;
}
