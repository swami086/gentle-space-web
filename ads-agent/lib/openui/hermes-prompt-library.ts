import { createLibrary } from "@openuidev/lang-core";
import type { Library } from "@openuidev/react-lang";
import { crmLibrary } from "./crm-library";
import { analyticsLibrary } from "./analytics-library";

/**
 * Server-only counterpart to hermes-library.ts's `hermesLibrary`, used purely to build Hermes'
 * system-prompt text (via `.prompt()`) from `lib/decision-engine/hermes-chat.ts`. It deliberately
 * excludes `@openuidev/react-ui`'s `openuiChatLibrary`: that package's components call
 * `React.createContext(...)` at module scope, which throws ("createContext is not a function") when
 * bundled into the server/route-handler module graph — Next.js resolves "react" differently there
 * than in the browser bundle. crmLibrary/analyticsLibrary are framework-light (plain
 * React.createElement, no hooks/context) and safe on both sides, so only they're merged here. The
 * render-capable `hermesLibrary` (openuiChatLibrary + crmLibrary + analyticsLibrary) still exists for
 * client-side rendering/parsing in the chat panels — see hermes-library.ts.
 */
export const hermesPromptLibrary = createLibrary({
  components: [...Object.values(crmLibrary.components), ...Object.values(analyticsLibrary.components)] as NonNullable<
    Parameters<typeof createLibrary>[0]["components"]
  >,
  componentGroups: [
    { name: "CRM", components: ["OpportunityCard", "OpportunityList", "StageChangeConfirm"] },
    { name: "Analytics", components: ["TrendChart", "DataTable"] },
  ],
}) as Library;
