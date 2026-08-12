import { readAttribution, writeAttribution } from "../db/attribution";
import type { Scope } from "../db/scope-sql";
import {
  fetchCorridorEnquiries,
  fetchCorridorSpend,
  fetchSourceWatermark,
  type AnalyticalQuery,
} from "./analytical-source";
import { freshness } from "./freshness";
import { applyFrozenWindow, reconcile, type AttributionResult } from "./reconcile";
import { windowState, type AttributionWindow } from "./window";

export async function rebuildAttribution(
  scope: Scope,
  deps: { query: AnalyticalQuery; window: AttributionWindow; now: Date },
): Promise<AttributionResult> {
  const state = windowState(deps.window, deps.now);

  const [watermark, spend, enquiries] = await Promise.all([
    fetchSourceWatermark(scope, deps.query),
    fetchCorridorSpend(scope, deps.query, deps.window),
    fetchCorridorEnquiries(scope, deps.query, deps.window),
  ]);

  const fresh = reconcile({ window: deps.window, windowState: state, spend, enquiries });

  let result = fresh;
  if (state === "closed") {
    const stored = await readAttribution(scope, deps.window);
    if (stored) {
      const frozen: AttributionResult = {
        window: stored.window,
        windowState: "closed",
        corridors: stored.corridors.map(({ authority, ...c }) => c),
        residual: stored.residual,
        lateEnquiryCount: stored.lateEnquiryCount,
        totals: stored.totals,
      };
      result = applyFrozenWindow(frozen, fresh);
    }
  }

  const f = freshness(deps.now, watermark);
  await writeAttribution(scope, result, f);
  return result;
}
