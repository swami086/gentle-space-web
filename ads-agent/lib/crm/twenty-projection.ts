// ads-agent/lib/crm/twenty-projection.ts
import {
  claimPendingContacts,
  markContactMergedIntoPerson,
  markContactSyncFailed,
  markContactSynced,
} from "../db/contacts";
import { withCrossTenantRead } from "../db/cross-tenant";
import { listEnquiriesAwaitingOpportunity, setTwentyOpportunityId } from "../db/enquiries";
import {
  claimUnsyncedActivities,
  markActivitySynced,
  type UnsyncedActivity,
} from "../db/enquiry-activities";
import type { ReplyState } from "../db/enquiries";
import type { Scope } from "../db/scope-sql";
import { touchTwentyLastSync } from "../db/twenty-connections";
import { getTwentyClient } from "./twenty-client";
import type { PipelineStageValue } from "./twenty-pipeline";

/**
 * Reply state is mapped to a pipeline stage, not conflated with it (A2).
 * `closed` maps to null on purpose: closing an enquiry says nothing about
 * whether the deal was won, lost or parked, so projecting a stage would write
 * a false deal outcome into the CRM. Null means "do not project".
 */
export const REPLY_STATE_TO_STAGE: Record<ReplyState, PipelineStageValue | null> = {
  waiting: "NEW_BRIEF",
  called: "SHORTLIST",
  closed: null,
};

export type ProjectionResult = { attempted: number; succeeded: number; failed: number };

function scopeFor(orgId: string): Scope {
  return { kind: "org", orgId };
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "23505");
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Interim mechanism for tenancy spec §7. The property the S4 gate needs is
 * that nothing on the request path touches Twenty, which a claim-based poller
 * satisfies as completely as a relay. At S5a this function becomes an outbox
 * consumer with the same signature.
 */
export async function projectPendingContacts(limit = 50): Promise<ProjectionResult> {
  const contacts = await withCrossTenantRead("twenty-projection.contacts", (client) =>
    claimPendingContacts(client, limit),
  );

  const result: ProjectionResult = { attempted: contacts.length, succeeded: 0, failed: 0 };

  for (const contact of contacts) {
    const scope = scopeFor(contact.orgId);
    try {
      const client = await getTwentyClient(contact.orgId);
      const [firstName, ...rest] = contact.name.trim().split(/\s+/);
      const person = await client.upsertPerson({
        firstName: firstName ?? "Unknown",
        lastName: rest.join(" ") || "-",
        phone: contact.phone,
        email: contact.email,
      });

      try {
        await markContactSynced(scope, contact.id, person.id, {
          name: `${person.firstName} ${person.lastName}`.trim(),
          phone: person.phone,
          email: person.email,
        });
      } catch (err) {
        // The unique (org_id, twenty_person_id) constraint is the dedup-merge
        // detector: another local row already holds this person, so Twenty
        // merged them and the surviving row is the truth (§8).
        if (!isUniqueViolation(err)) throw err;
        const survivorId = await markContactMergedIntoPerson(scope, contact.id, person.id);
        if (!survivorId) throw err;
      }

      const enquiries = await listEnquiriesAwaitingOpportunity(scope, contact.id);
      for (const enquiry of enquiries) {
        const opportunity = await client.createOpportunity({
          name: enquiry.contactName ?? contact.name,
          personId: person.id,
          stage: REPLY_STATE_TO_STAGE[enquiry.replyState] ?? "NEW_BRIEF",
          listingUrl: enquiry.listingUrl,
          listingName: null,
        });
        await setTwentyOpportunityId(scope, enquiry.id, opportunity.id);
      }

      await touchTwentyLastSync(contact.orgId);
      result.succeeded++;
    } catch (err) {
      // One bad contact is not an unhealthy instance. The error lands on the
      // contact row so backoff widens for it alone.
      await markContactSyncFailed(scope, contact.id, message(err));
      result.failed++;
    }
  }

  return result;
}

function humaniseOutcome(outcome: string): string {
  return outcome.replace(/_/g, " ");
}

function humaniseDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatActivityNote(activity: UnsyncedActivity): string {
  const day = activity.occurredAt.slice(0, 10);
  const header =
    activity.kind === "call"
      ? `Call on ${day}: ${humaniseOutcome(activity.callOutcome ?? "unknown")}` +
        (activity.callSeconds === null ? "" : ` (${humaniseDuration(activity.callSeconds)})`)
      : `Note on ${day}`;
  return `${header}\n\n${activity.body ?? ""}`.trimEnd();
}

/** Note write-back (C7). Twenty cannot hold the call itself, only a note about it. */
export async function projectPendingActivities(limit = 50): Promise<ProjectionResult> {
  const activities = await withCrossTenantRead("twenty-projection.activities", (client) =>
    claimUnsyncedActivities(client, limit),
  );

  const result: ProjectionResult = { attempted: activities.length, succeeded: 0, failed: 0 };

  for (const activity of activities) {
    try {
      const client = await getTwentyClient(activity.orgId);
      await client.createNote(activity.twentyOpportunityId, formatActivityNote(activity));
      await markActivitySynced(scopeFor(activity.orgId), activity.id);
      result.succeeded++;
    } catch (err) {
      // Deliberately not stamped: synced_to_twenty_at stays NULL so the next
      // tick claims it again. There is no attempt counter on activities, so a
      // permanently broken instance shows up as a growing unsynced backlog
      // rather than as silently dropped notes.
      console.error("twenty-projection: activity note failed", {
        activityId: activity.id,
        orgId: activity.orgId,
        error: message(err),
      });
      result.failed++;
    }
  }

  return result;
}

/** Projects a reply-state change outward. A null stage means do not project. */
export async function projectReplyState(
  scope: Scope,
  enquiryId: string,
  replyState: ReplyState,
  opportunityId: string | null,
): Promise<void> {
  const stage = REPLY_STATE_TO_STAGE[replyState];
  if (!stage || !opportunityId || scope.kind !== "org") return;
  try {
    const client = await getTwentyClient(scope.orgId);
    await client.updateOpportunityStage(opportunityId, stage);
  } catch (err) {
    // A failed projection is retried by the next activity tick and surfaces on
    // last_error; it never blocks the broker (§7).
    console.error("twenty-projection: reply state projection failed", {
      enquiryId,
      replyState,
      error: message(err),
    });
  }
}
