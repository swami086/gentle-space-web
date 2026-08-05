import { createLibrary, type DefinedComponent } from "@openuidev/lang-core";
import { campaignLibrary } from "./campaign-library";
import { sharedLibrary } from "./shared-library";

/**
 * The global Copilot's composed component registry: every domain library's components plus the
 * nine shared ones, merged into one Library with no fixed root (the model chooses which
 * registered component fits each turn). Today this merges campaignLibrary (Spec 1, shipped) and
 * sharedLibrary (Task 8) — crmLibrary/analyticsLibrary (Specs 2/3) are unbuilt and are added here
 * unchanged, one line each, once they exist (foundation spec's Migration path). Embedded per-page
 * chats (Campaign Chat today) keep using their own narrower domain-only library, unaffected by
 * this composition.
 */
export const platformLibrary = createLibrary({
  // Same heterogeneous-component widen as shared-library.ts — createLibrary's C param can't unify
  // SetupCard + nine shared prop shapes without an assertion.
  components: [
    ...Object.values(campaignLibrary.components),
    ...Object.values(sharedLibrary.components),
  ] as DefinedComponent<any, any>[],
});
