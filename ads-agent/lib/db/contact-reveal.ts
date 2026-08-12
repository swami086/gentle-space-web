import { recordAccess } from "./access-log";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export type RevealedContact = {
  name: string | null;
  phone: string | null;
  email: string | null;
  /** Which of the two identity sources this came from, so the broker can tell. */
  source: "twenty" | "captured";
};

type RevealRow = {
  captured_name: string | null;
  captured_phone: string | null;
  captured_email: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  sync_state: string | null;
};

/**
 * The authorised unmask (A5). maskPhone() hides the number on every CRM
 * surface; this is the one path that returns it, and it audits itself in the
 * same transaction as the read so there is no window in which a reveal
 * happened and no log exists.
 *
 * Twenty's reconciled value wins when the contact is synced, because its dedup
 * may have merged the person and the merged result is the truth (§3). The
 * `source` field is not decoration: a broker needs to know whether they are
 * looking at a corrected number or the one the enquirer typed.
 */
export async function revealContact(
  scope: Scope,
  enquiryId: string,
  actorUserId: string,
): Promise<RevealedContact | null> {
  orgIdForWrite(scope);
  const clause = scopeClause(scope, "e.org_id");

  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<RevealRow>(
      `SELECT e.contact_name  AS captured_name,
              e.contact_phone AS captured_phone,
              e.contact_email AS captured_email,
              c.name          AS contact_name,
              c.phone         AS contact_phone,
              c.email         AS contact_email,
              c.sync_state    AS sync_state
         FROM adsagent.enquiries e
         LEFT JOIN adsagent.contacts c ON c.id = e.contact_id AND c.org_id = e.org_id
        WHERE ${clause.sql} AND e.lifecycle = 'active' AND e.id = $${clause.params.length + 1}`,
      [...clause.params, enquiryId],
    );
    const row = rows[0];
    if (!row) return null;

    await recordAccess(
      scope,
      {
        actorKind: "user",
        actorRef: actorUserId,
        action: "contact.reveal",
        subjectKind: "enquirer",
        subjectRef: enquiryId,
      },
      client,
    );

    if (row.sync_state === "synced") {
      return {
        name: row.contact_name,
        phone: row.contact_phone,
        email: row.contact_email,
        source: "twenty",
      };
    }
    return {
      name: row.captured_name ?? row.contact_name,
      phone: row.captured_phone,
      email: row.captured_email,
      source: "captured",
    };
  });
}
