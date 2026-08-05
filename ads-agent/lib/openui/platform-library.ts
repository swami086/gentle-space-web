import { createLibrary } from "@openuidev/lang-core";
import { campaignLibrary } from "./campaign-library";
import { crmLibrary } from "./crm-library";
import { analyticsLibrary } from "./analytics-library";
import { sharedLibrary } from "./shared-library";

type LibraryComponents = NonNullable<Parameters<typeof createLibrary>[0]["components"]>;

/** The global Copilot's composed component registry — every domain library's components plus the
 * shared ones. Now includes crmLibrary (Spec 3, Task 9) and analyticsLibrary (Spec 2, Task 10), added
 * per the foundation spec's own documented migration path (one line each, unchanged composition
 * shape from before). Embedded per-page chats (Campaign Chat, CRM Assistant, Reports) keep using
 * their own narrower domain-only library, unaffected by this composition. */
export const platformLibrary = createLibrary({
  components: [
    ...Object.values(campaignLibrary.components),
    ...Object.values(crmLibrary.components),
    ...Object.values(analyticsLibrary.components),
    ...Object.values(sharedLibrary.components),
  ] as LibraryComponents,
});
