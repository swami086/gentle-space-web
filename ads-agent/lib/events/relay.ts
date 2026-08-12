import type { PoolClient } from "pg";
import { claimUnpublished, markFailed, markPublished } from "../db/outbox";
import type { Scope } from "../db/scope-sql";
import { withTenantTransaction } from "../db/tx";
import { toPublishableMessage } from "./envelope";
import type { Publisher } from "./publisher";
import { relayPool } from "./relay-pool";
import { DELETION_TOPIC } from "./topics";

/**
 * Claim, publish, mark — one transaction (datastore spec §14.1).
 *
 * If the process dies after publishing but before COMMIT, the rows stay
 * unpublished and are published again on the next tick. That is at-least-once
 * delivery: duplicates, never loss. It is why every consumer de-duplicates on
 * the outbox event id (lib/events/idempotency.ts) and why the correctness of
 * deletion comes from reconciliation (§14.4), not from delivery.
 *
 * ponytail: publishing while the claim transaction is open holds row locks
 * across network I/O. Bounded by batchSize (default 100, ~1s). Upgrade path if
 * that ceiling is ever reached: add a claimed_at lease column, commit the
 * claim, publish outside the transaction, then mark published in a second one.
 */
export type RelayDeps = {
  publisher: Publisher;
  batchSize: number;
  perOrgCeiling: number;
};

export type RelayTick = {
  claimed: number;
  published: number;
  failed: number;
  deferred: number;
  deletionFailures: string[];
};

const PLATFORM: Scope = { kind: "platform", orgId: "00000000-0000-0000-0000-000000000000" };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function logRelayAccess(client: PoolClient, orgIds: string[]): Promise<void> {
  for (const orgId of orgIds) {
    await client.query(
      `INSERT INTO context.access_log (org_id, actor_kind, actor_ref, action)
       VALUES ($1, 'cross_tenant', 'outbox-relay', 'outbox.publish')`,
      [orgId],
    );
  }
}

export async function runRelayOnce(deps: RelayDeps): Promise<RelayTick> {
  const { publisher, batchSize, perOrgCeiling } = deps;

  return withTenantTransaction(
    PLATFORM,
    async (client) => {
      const rows = await claimUnpublished(PLATFORM, client, batchSize);
      const takenPerOrg = new Map<string, number>();
      const publishedIds: string[] = [];
      const deletionFailures: string[] = [];
      let failed = 0;
      let deferred = 0;

      for (const row of rows) {
        const taken = takenPerOrg.get(row.orgId) ?? 0;
        if (taken >= perOrgCeiling) {
          // §12.6 applied to the relay: one tenant's burst must not starve the
          // others. The row stays unpublished and is claimed next tick.
          deferred += 1;
          continue;
        }
        takenPerOrg.set(row.orgId, taken + 1);
        try {
          await publisher.publish(toPublishableMessage(row));
          publishedIds.push(row.id);
        } catch (err) {
          failed += 1;
          if (row.topic === DELETION_TOPIC) deletionFailures.push(row.id);
          // Ordered publishing pauses the key on failure until it is resumed.
          publisher.resume(row.topic, row.orderingKey);
          await markFailed(PLATFORM, client, row.id, errorText(err));
        }
      }

      await markPublished(PLATFORM, client, publishedIds);
      await logRelayAccess(client, [...takenPerOrg.keys()]);

      if (deletionFailures.length > 0) {
        // §14.4: a lost deletion event is a compliance failure, not a missed
        // update, so it gets an alert of its own rather than sharing the
        // ordinary publish-failure counter.
        console.error(
          `ALERT outbox.deletion_publish_failed count=${deletionFailures.length} ids=${deletionFailures.join(",")}`,
        );
      }

      return {
        claimed: rows.length,
        published: publishedIds.length,
        failed,
        deferred,
        deletionFailures,
      };
    },
    relayPool(),
  );
}
