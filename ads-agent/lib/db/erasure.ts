import { recordAccess } from "./access-log";
import { withCrossTenantRead } from "./cross-tenant";
import {
  createDeletionRequest,
  listDueErasures,
  markErased,
  setPropagation,
} from "./deletion-requests";
import type { Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

/**
 * Step 1 and 2 of the three-step erasure in datastore §11.1: suppress
 * immediately, retain physically for the statutory floor. The hard delete is
 * runErasureSweep, on a schedule.
 *
 * Suppression works because every read in the enquiry spine carries
 * `lifecycle = 'active'`. That is why this had to be designed in at S4:
 * retrofitting it would mean auditing every read instead of adding one column.
 */
export async function suppressEnquiry(
  scope: Scope,
  enquiryId: string,
  actorUserId: string,
): Promise<{ requestId: string } | null> {
  const orgId = orgIdForWrite(scope);

  const request = await withTenantTransaction(scope, async (client) => {
    const found = await client.query<{ id: string; contact_id: string | null }>(
      `SELECT id, contact_id FROM adsagent.enquiries
        WHERE org_id = $1 AND id = $2 AND lifecycle = 'active'
          FOR UPDATE`,
      [orgId, enquiryId],
    );
    if (!found.rows[0]) return null;
    const contactId = found.rows[0].contact_id;

    const ledger = await createDeletionRequest(scope, {
      subjectKind: "enquirer",
      subjectRef: enquiryId,
    });

    await client.query(
      `UPDATE adsagent.enquiries
          SET lifecycle = 'suppressed', suppressed_at = now(),
              erase_after = $3::date, updated_at = now()
        WHERE org_id = $1 AND id = $2`,
      [orgId, enquiryId, ledger.eraseAfter],
    );

    if (contactId) {
      // Only if this was the contact's last active enquiry: a person with a
      // live enquiry elsewhere has not asked to be forgotten.
      await client.query(
        `UPDATE adsagent.contacts c
            SET lifecycle = 'suppressed', suppressed_at = now(),
                erase_after = $3::date, updated_at = now()
          WHERE c.org_id = $1 AND c.id = $2
            AND NOT EXISTS (
              SELECT 1 FROM adsagent.enquiries e
               WHERE e.org_id = c.org_id AND e.contact_id = c.id AND e.lifecycle = 'active'
            )`,
        [orgId, contactId, ledger.eraseAfter],
      );
    }

    await recordAccess(
      scope,
      {
        actorKind: "user",
        actorRef: actorUserId,
        action: "enquiry.suppress",
        subjectKind: "enquirer",
        subjectRef: enquiryId,
      },
      client,
    );

    return ledger;
  });

  if (!request) return null;

  await setPropagation(scope, request.id, "postgres", "suppressed", null);
  // Deliberately pending, not skipped. This module must not import the Twenty
  // client -- the request path cannot depend on Twenty being up -- so the
  // person deletion is owed, and the ledger row is what makes the debt visible
  // to a regulator instead of invisible.
  await setPropagation(
    scope,
    request.id,
    "twenty",
    "pending",
    "awaiting the projection worker's deletion consumer (S5a)",
  );

  return { requestId: request.id };
}

/**
 * Step 3: the hard delete, once the floor has passed. The enquiry shell
 * survives with `lifecycle = 'erased'` and its personal columns nulled, so a
 * dangling reference renders "content erased" instead of an unexplained 404 —
 * and so the row count stays auditable.
 */
export async function hardEraseEnquiry(scope: Scope, enquiryId: string): Promise<void> {
  const orgId = orgIdForWrite(scope);
  await withTenantTransaction(scope, async (client) => {
    await client.query(
      `UPDATE adsagent.enquiries
          SET lifecycle = 'erased',
              contact_name = NULL,
              contact_phone = NULL,
              contact_email = NULL,
              updated_at = now()
        WHERE org_id = $1 AND id = $2`,
      [orgId, enquiryId],
    );
    await client.query(
      `UPDATE adsagent.enquiry_messages SET body = '[erased]'
        WHERE org_id = $1 AND enquiry_id = $2`,
      [orgId, enquiryId],
    );
    await client.query(
      `UPDATE adsagent.enquiry_activities SET body = NULL
        WHERE org_id = $1 AND enquiry_id = $2 AND body IS NOT NULL`,
      [orgId, enquiryId],
    );
    await client.query(
      `UPDATE adsagent.contacts c
          SET lifecycle = 'erased', name = '[erased]', phone = NULL, email = NULL,
              updated_at = now()
        WHERE c.org_id = $1
          AND c.id = (SELECT contact_id FROM adsagent.enquiries
                       WHERE org_id = $1 AND id = $2)
          AND NOT EXISTS (
            SELECT 1 FROM adsagent.enquiries e
             WHERE e.org_id = c.org_id AND e.contact_id = c.id AND e.lifecycle <> 'erased'
          )`,
      [orgId, enquiryId],
    );
  });
}

export async function runErasureSweep(limit = 100): Promise<{ erased: number }> {
  const due = await withCrossTenantRead("erasure-sweep", (client) =>
    listDueErasures(client, limit),
  );

  let erased = 0;
  for (const request of due) {
    const scope: Scope = { kind: "org", orgId: request.orgId };
    if (request.subjectKind !== "enquirer") {
      // 'user' and 'tenant' erasure are not this plan's scope, and guessing at
      // them would be worse than recording that they are outstanding.
      await setPropagation(
        scope,
        request.id,
        "postgres",
        "failed",
        `subject_kind ${request.subjectKind} has no erasure path yet`,
      );
      continue;
    }
    await hardEraseEnquiry(scope, request.subjectRef);
    await setPropagation(scope, request.id, "postgres", "erased", null);
    await markErased(scope, request.id);
    erased++;
  }
  return { erased };
}
