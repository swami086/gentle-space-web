import { claimRebuild, failRebuild, finishRebuild } from "../lib/context-graph/backpressure";
import { buildGraphSnapshot } from "../lib/context-graph/build";
import { collectSnapshots, recordSnapshot } from "../lib/context-graph/snapshot-lease";
import { exportSnapshot } from "../lib/context-graph/snapshot-export";
import { ObjectStore } from "../lib/objectstore/client";

/**
 * One cycle: claim at most one tenant (the slots table caps how many workers
 * hold a claim at once), rebuild it, export its snapshot, then collect.
 * Connect as context_maintenance -- claiming reads across tenants.
 */
async function cycle(): Promise<boolean> {
  const claim = await claimRebuild();
  if (!claim) return false;

  const scope = { kind: "platform" as const, orgId: claim.orgId };
  try {
    const build = await buildGraphSnapshot(claim.orgId, claim.snapshotId);
    const exported = await exportSnapshot(scope, claim.snapshotId, claim.generation, build);

    await recordSnapshot(scope, {
      orgId: claim.orgId,
      snapshotId: claim.snapshotId,
      generation: claim.generation,
      bucket: exported.bucket,
      storageKey: exported.storageKey,
      byteSize: exported.byteSize,
      checksum: exported.checksum,
      sourceWatermark: build.sourceWatermark,
      cdcLagSeconds: build.cdcLagSeconds,
    });

    await finishRebuild(claim, {
      sourceWatermark: build.sourceWatermark,
      cdcLagSeconds: build.cdcLagSeconds,
    });
    console.log(
      `rebuilt ${claim.orgId} gen=${claim.generation} nodes=${build.nodeCount} ` +
        `edges=${build.edgeCount} lag=${build.cdcLagSeconds}s`,
    );
    return true;
  } catch (err) {
    await failRebuild(claim, err instanceof Error ? err.message : String(err));
    console.error(`rebuild failed for ${claim.orgId}`, err);
    return true;
  }
}

async function main(): Promise<void> {
  let worked = 0;
  while (await cycle()) worked += 1;

  const collection = await collectSnapshots(ObjectStore.fromEnv());
  console.log(
    `rebuilds=${worked} collected=${collection.collected.length} ` +
      `blockedByLease=${collection.blockedByLease}`,
  );
  if (collection.currentGenerationExpired.length > 0) {
    console.warn(
      "current-generation snapshots expired and were collected; those tenants are pending",
      collection.currentGenerationExpired,
    );
  }
}

main().catch((err) => {
  console.error("graph rebuild worker failed", err);
  process.exit(1);
});
