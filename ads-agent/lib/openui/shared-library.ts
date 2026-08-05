import { createLibrary, type DefinedComponent } from "@openuidev/lang-core";
import { StatCard, KpiGrid } from "./shared-metric-cards";
import { InsightCallout, ChecklistCard, AlertBanner } from "./shared-narrative-cards";
import { ComparisonCard, Timeline, RankedList, BatchActionConfirm } from "./shared-structured-views";

export * from "./shared-metric-cards";
export * from "./shared-narrative-cards";
export * from "./shared-structured-views";

/**
 * The nine general-purpose, domain-agnostic OpenUI components (foundation spec's "New shared,
 * general-purpose components" table). No fixed `root` — unlike campaignLibrary (always renders
 * SetupCard), any of these nine may be the model's chosen root for a given turn, since which one
 * fits depends entirely on the question asked. platform-library.ts (Task 10) composes this with
 * campaignLibrary for the global Copilot; individual domain libraries (Specs 2/3, once built) are
 * expected to import from here rather than redefining any of these nine (see foundation spec's
 * Migration path — StatCard specifically is owned here, not by analytics-library.ts).
 */
export const sharedLibrary = createLibrary({
  // Heterogeneous DefinedComponent props don't share a common C — widen for createLibrary.
  components: [
    StatCard,
    KpiGrid,
    InsightCallout,
    ChecklistCard,
    AlertBanner,
    ComparisonCard,
    Timeline,
    RankedList,
    BatchActionConfirm,
  ] as DefinedComponent<any, any>[],
});
