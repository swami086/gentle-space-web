import { getPool } from "../db/client";
import { chCommand, chQuery } from "./clickhouse";

/**
 * Data model §8 lists ten node kinds and eleven relationships. Two pairs are
 * excluded because no spec defines a source for them, and an empty table that
 * looks populated is worse than an absent one:
 *   - POI / NEAR               : needs an OpenStreetMap ingestion no spec defines.
 *   - Organisation / WORKS_FOR  : needs an employer column adsagent.contacts
 *                                 does not have.
 */
export const NODE_KINDS = [
  "Space",
  "Corridor",
  "Person",
  "Enquiry",
  "Requirement",
  "Campaign",
  "Call",
  "Outcome",
] as const;

export const RELATIONSHIP_KINDS = [
  "PART_OF",
  "LOCATED_IN",
  "ENQUIRED_ABOUT",
  "HAS_REQUIREMENT",
  "TARGETS",
  "GENERATED",
  "ABOUT",
  "RESULTED_IN",
  "SIMILAR_TO",
] as const;

const G = "gentle_space";

/**
 * One INSERT per kind, all scoped to one tenant and one snapshot. A rebuild
 * lands as a new snapshot and swaps atomically (§6.2), so nothing here mutates
 * or deletes an existing row.
 */
export function graphBuildStatements(orgId: string, snapshotId: string): string[] {
  const org = `toUUID('${orgId}')`;
  const snap = `toUUID('${snapshotId}')`;

  const node = (
    kind: string,
    idExpr: string,
    labelExpr: string,
    subjectExpr: string,
    propsExpr: string,
    from: string,
    where: string,
  ) => `INSERT INTO ${G}.graph_node
  (org_id, snapshot_id, node_id, node_kind, label, subject_ref, props)
SELECT ${org}, ${snap}, ${idExpr}, '${kind}', ${labelExpr}, ${subjectExpr}, ${propsExpr}
  FROM ${from}
 WHERE org_id = ${org} AND ${where}`;

  const edge = (
    sourceKind: string,
    kind: string,
    targetKind: string,
    sourceExpr: string,
    targetExpr: string,
    props: string,
    from: string,
    where: string,
  ) => `INSERT INTO ${G}.graph_edge
  (org_id, snapshot_id, source_id, source_kind, relationship_kind, target_id, target_kind,
   meters, weight, confidence, props)
SELECT ${org}, ${snap}, ${sourceExpr}, '${sourceKind}', '${kind}', ${targetExpr}, '${targetKind}',
       ${props}
  FROM ${from}
 WHERE org_id = ${org} AND ${where}`;

  return [
    // --- nodes -----------------------------------------------------------
    node(
      "Space",
      "id",
      "title",
      "NULL",
      `toJSONString(map('area', area, 'city', city))`,
      `${G}.listings`,
      "is_active = 1",
    ),
    node(
      "Corridor",
      "id",
      "display_name",
      "NULL",
      `toJSONString(map('slug', slug))`,
      `${G}.corridors`,
      "1 = 1",
    ),
    // A Person node and everything downstream of an enquirer carries
    // provenance, so erasure can prune it (datastore §11.2, validation F-18).
    node("Person", "id", "full_name", "toString(id)", "'{}'", `${G}.contacts`, "1 = 1"),
    node(
      "Enquiry",
      "id",
      "reply_state",
      "toString(contact_id)",
      `toJSONString(map('reply_state', reply_state))`,
      `${G}.enquiries`,
      "lifecycle = 'active'",
    ),
    node(
      "Requirement",
      "enquiry_id",
      "'requirement'",
      "NULL",
      `toJSONString(map('desks_min', toString(desks_min), 'desks_max', toString(desks_max)))`,
      `${G}.enquiry_requirements`,
      "1 = 1",
    ),
    node(
      "Campaign",
      "id",
      "name",
      "NULL",
      `toJSONString(map('status', status))`,
      `${G}.campaigns`,
      "1 = 1",
    ),
    node(
      "Call",
      "id",
      "call_outcome",
      "NULL",
      `toJSONString(map('seconds', toString(call_seconds)))`,
      `${G}.enquiry_activities`,
      "kind = 'call'",
    ),
    // An Outcome node exists only for a closed enquiry; its label is what the
    // conversion traversal counts.
    node(
      "Outcome",
      "id",
      `if(reply_state = 'closed', 'won', 'open')`,
      "toString(contact_id)",
      "'{}'",
      `${G}.enquiries`,
      "reply_state = 'closed' AND lifecycle = 'active'",
    ),

    // --- edges -----------------------------------------------------------
    // Hierarchy as edges, not materialised paths (§6.2, data model §4).
    edge(
      "Corridor",
      "PART_OF",
      "Corridor",
      "id",
      "parent_id",
      "NULL, NULL, NULL, '{}'",
      `${G}.corridors`,
      "parent_id IS NOT NULL",
    ),
    edge(
      "Space",
      "LOCATED_IN",
      "Corridor",
      "listing_id",
      "corridor_id",
      "NULL, NULL, confidence, '{}'",
      `${G}.listing_corridors`,
      "1 = 1",
    ),
    edge(
      "Person",
      "ENQUIRED_ABOUT",
      "Space",
      "contact_id",
      "listing_id",
      "NULL, NULL, NULL, '{}'",
      `${G}.enquiries`,
      "contact_id IS NOT NULL AND listing_id IS NOT NULL AND lifecycle = 'active'",
    ),
    edge(
      "Enquiry",
      "HAS_REQUIREMENT",
      "Requirement",
      "enquiry_id",
      "enquiry_id",
      "NULL, NULL, NULL, '{}'",
      `${G}.enquiry_requirements`,
      "1 = 1",
    ),
    edge(
      "Campaign",
      "TARGETS",
      "Corridor",
      "id",
      "corridor_id",
      "NULL, NULL, NULL, '{}'",
      `${G}.campaigns`,
      "corridor_id IS NOT NULL",
    ),
    // Attribution is inferred, never measured, so the edge carries a confidence
    // rather than pretending to be a fact (data model §8, §4).
    edge(
      "Campaign",
      "GENERATED",
      "Enquiry",
      "campaign_id",
      "id",
      "NULL, NULL, 0.5, '{}'",
      `${G}.enquiries`,
      "campaign_id IS NOT NULL AND lifecycle = 'active'",
    ),
    edge(
      "Call",
      "ABOUT",
      "Enquiry",
      "id",
      "enquiry_id",
      "NULL, NULL, NULL, '{}'",
      `${G}.enquiry_activities`,
      "kind = 'call'",
    ),
    edge(
      "Enquiry",
      "RESULTED_IN",
      "Outcome",
      "id",
      "id",
      "NULL, NULL, NULL, '{}'",
      `${G}.enquiries`,
      "reply_state = 'closed' AND lifecycle = 'active'",
    ),
  ];
}

export type BuildResult = {
  snapshotId: string;
  nodeCount: number;
  edgeCount: number;
  sourceWatermark: Date;
  cdcLagSeconds: number;
};

export async function buildGraphSnapshot(
  orgId: string,
  snapshotId: string,
): Promise<BuildResult> {
  for (const statement of graphBuildStatements(orgId, snapshotId)) {
    await chCommand(statement, { orgId });
  }
  await buildSimilarityEdges(orgId, snapshotId);

  const [counts] = await chQuery<{ nodes: string; edges: string; watermark: string | null }>(
    `SELECT
       toString((SELECT count() FROM ${G}.graph_node
                  WHERE org_id = toUUID({org:String})
                    AND snapshot_id = toUUID({snap:String}))) AS nodes,
       toString((SELECT count() FROM ${G}.graph_edge
                  WHERE org_id = toUUID({org:String})
                    AND snapshot_id = toUUID({snap:String}))) AS edges,
       toString((SELECT max(last_activity_at) FROM ${G}.enquiries
                  WHERE org_id = toUUID({org:String}))) AS watermark`,
    { orgId, params: { org: orgId, snap: snapshotId } },
  );

  // §12.1: the build records the lag it observed, so a context pack can carry
  // its own age and an agent can refuse to act on stale data.
  const sourceWatermark = counts.watermark
    ? new Date(counts.watermark.replace(" ", "T") + "Z")
    : new Date(0);
  const cdcLagSeconds = Math.max(
    0,
    Math.round((Date.now() - sourceWatermark.getTime()) / 1000),
  );

  return {
    snapshotId,
    nodeCount: Number(counts.nodes),
    edgeCount: Number(counts.edges),
    sourceWatermark,
    cdcLagSeconds,
  };
}

/**
 * SIMILAR_TO is vector-derived, and pgvector lives in Postgres. This resolves
 * datastore open question 6 in favour of "the graph references Postgres for
 * similarity": only the resulting pairs cross into ClickHouse, never the
 * embeddings themselves.
 *
 * listings.listings is shared reference data rather than a tenant table -- like
 * public.corridors -- so this query carries no scopeClause; orgId enters only as
 * the tenant stamp on the emitted edges. If listings later becomes tenant-scoped,
 * this query gains a scopeClause and the type checker will say so.
 */
export async function buildSimilarityEdges(
  orgId: string,
  snapshotId: string,
  opts: { perSpace?: number; minWeight?: number } = {},
): Promise<number> {
  const perSpace = opts.perSpace ?? 5;
  const minWeight = opts.minWeight ?? 0.75;

  const { rows } = await getPool().query<{
    source_id: string;
    target_id: string;
    weight: number;
  }>(
    `SELECT source_id, target_id, weight
       FROM (
         SELECT a.id AS source_id,
                b.id AS target_id,
                1 - (a.structured_embedding <=> b.structured_embedding) AS weight,
                row_number() OVER (
                  PARTITION BY a.id
                  ORDER BY a.structured_embedding <=> b.structured_embedding
                ) AS rn
           FROM listings.listings a
           JOIN listings.listings b
             ON b.id <> a.id
            AND b.is_active
            AND b.structured_embedding IS NOT NULL
          WHERE a.is_active
            AND a.structured_embedding IS NOT NULL
       ) ranked
      WHERE rn <= $1 AND weight >= $2`,
    [perSpace, minWeight],
  );

  if (rows.length === 0) return 0;

  const values = rows
    .map(
      (r) =>
        `(toUUID('${orgId}'), toUUID('${snapshotId}'), toUUID('${r.source_id}'), 'Space',` +
        ` 'SIMILAR_TO', toUUID('${r.target_id}'), 'Space', NULL,` +
        ` ${r.weight.toFixed(6)}, NULL, '{}')`,
    )
    .join(",\n");

  await chCommand(
    `INSERT INTO ${G}.graph_edge
       (org_id, snapshot_id, source_id, source_kind, relationship_kind, target_id, target_kind,
        meters, weight, confidence, props)
     VALUES\n${values}`,
    { orgId },
  );
  return rows.length;
}
