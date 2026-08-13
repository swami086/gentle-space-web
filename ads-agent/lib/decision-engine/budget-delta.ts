function payloadBudgetInr(
  payload: Record<string, unknown>,
  ...keys: string[]
): number {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && !Number.isNaN(value)) return value;
  }
  return 0;
}

/** Signed INR delta for list rows. null when kind has no budget impact. */
export function budgetDeltaInr(input: {
  kind: string;
  payload: Record<string, unknown>;
  currentDailyBudgetInr?: number | null;
}): number | null {
  const current = input.currentDailyBudgetInr ?? 0;

  switch (input.kind) {
    case "budget_change":
      return payloadBudgetInr(input.payload, "newDailyBudgetInr") - current;
    case "create_campaign":
      return payloadBudgetInr(input.payload, "dailyBudgetInr", "newDailyBudgetInr");
    case "pause":
      return current ? -current : 0;
    default:
      return null;
  }
}
