import type { Scope } from "../db/scope-sql";
import { chQuery } from "./clickhouse";

/**
 * Every traversal in the system lives here. Dropping the graph engine means
 * multi-hop queries are hand-written joins; the mitigation on record
 * (datastore §9) is to keep them behind named functions rather than scattered
 * across callers. Nothing outside this file writes graph SQL.
 *
 * Depth is bounded, never variable-length, so the same shape translates to
 * SQL/PGQ GRAPH_TABLE by declaration once PostgreSQL 19 is GA (§6.1).
 */
const G = "gentle_space";
const TENANT = `org_id = toUUID({org:String}) AND snapshot_id = toUUID({snap:String})`;

export type ConvertingCorridor = {
  corridorId: string;
  corridorLabel: string;
  enquiries: number;
  converted: number;
  conversionRate: number;
};

/**
 * Which corridors do converting enquiries come from (§6)?
 *
 * There is no Enquiry->Corridor edge in data model §8, so the corridor is
 * reached through the campaign:
 *   Corridor <-TARGETS- Campaign -GENERATED-> Enquiry -RESULTED_IN-> Outcome
 * The confidence on GENERATED is the reminder that attribution is inferred.
 */
export async function convertingCorridors(
  scope: Scope,
  snapshotId: string,
  opts: { minEnquiries?: number } = {},
): Promise<ConvertingCorridor[]> {
  const rows = await chQuery<{
    corridorId: string;
    corridorLabel: string;
    enquiries: string;
    converted: string;
    conversionRate: number;
  }>(
    `WITH campaign_corridor AS (
       SELECT source_id AS campaign_id, target_id AS corridor_id
         FROM ${G}.graph_edge
        WHERE ${TENANT} AND relationship_kind = 'TARGETS'
          AND source_kind = 'Campaign' AND target_kind = 'Corridor'
     ),
     campaign_enquiry AS (
       SELECT source_id AS campaign_id, target_id AS enquiry_id
         FROM ${G}.graph_edge
        WHERE ${TENANT} AND relationship_kind = 'GENERATED'
          AND source_kind = 'Campaign' AND target_kind = 'Enquiry'
     ),
     enquiry_outcome AS (
       SELECT e.source_id AS enquiry_id, n.label AS outcome
         FROM ${G}.graph_edge e
         INNER JOIN ${G}.graph_node n
                 ON n.org_id = e.org_id AND n.snapshot_id = e.snapshot_id
                AND n.node_id = e.target_id AND n.node_kind = 'Outcome'
        WHERE e.${TENANT} AND e.relationship_kind = 'RESULTED_IN'
          AND e.source_kind = 'Enquiry'
     )
     SELECT toString(cc.corridor_id)                     AS corridorId,
            any(cn.label)                                AS corridorLabel,
            toString(count())                            AS enquiries,
            toString(countIf(eo.outcome = 'won'))        AS converted,
            countIf(eo.outcome = 'won') / count()        AS conversionRate
       FROM campaign_corridor cc
       INNER JOIN campaign_enquiry ce ON ce.campaign_id = cc.campaign_id
       LEFT  JOIN enquiry_outcome  eo ON eo.enquiry_id  = ce.enquiry_id
       INNER JOIN ${G}.graph_node  cn
               ON cn.${TENANT} AND cn.node_id = cc.corridor_id AND cn.node_kind = 'Corridor'
      GROUP BY cc.corridor_id
     HAVING count() >= {minEnquiries:UInt32}
      ORDER BY conversionRate DESC, count() DESC`,
    {
      // Explicit predicate AND the row-policy setting: application filtering is
      // the front line, RLS is the backstop for developer error.
      orgId: scope.orgId,
      params: {
        org: scope.orgId,
        snap: snapshotId,
        minEnquiries: String(opts.minEnquiries ?? 1),
      },
    },
  );

  return rows.map((r) => ({
    corridorId: r.corridorId,
    corridorLabel: r.corridorLabel,
    enquiries: Number(r.enquiries),
    converted: Number(r.converted),
    conversionRate: Number(r.conversionRate),
  }));
}

export type SubstituteSpace = {
  spaceId: string;
  label: string;
  weight: number;
  corridorId: string | null;
};

/**
 * Which spaces are substitutes for the one a client rejected (§6)?
 *   Space -SIMILAR_TO-> Space -LOCATED_IN-> Corridor
 */
export async function substituteSpaces(
  scope: Scope,
  snapshotId: string,
  spaceId: string,
  limit = 10,
): Promise<SubstituteSpace[]> {
  const rows = await chQuery<{
    spaceId: string;
    label: string;
    weight: number;
    corridorId: string | null;
  }>(
    `SELECT toString(sim.target_id)                       AS spaceId,
            n.label                                       AS label,
            sim.weight                                    AS weight,
            nullIf(toString(any(loc.target_id)), '')      AS corridorId
       FROM ${G}.graph_edge sim
       INNER JOIN ${G}.graph_node n
               ON n.${TENANT} AND n.node_id = sim.target_id AND n.node_kind = 'Space'
       LEFT  JOIN ${G}.graph_edge loc
               ON loc.org_id = sim.org_id AND loc.snapshot_id = sim.snapshot_id
              AND loc.source_id = sim.target_id AND loc.relationship_kind = 'LOCATED_IN'
      WHERE sim.${TENANT}
        AND sim.relationship_kind = 'SIMILAR_TO'
        AND sim.source_id = toUUID({space:String})
      GROUP BY sim.target_id, n.label, sim.weight
      ORDER BY weight DESC
      LIMIT {limit:UInt32}`,
    {
      orgId: scope.orgId,
      params: { org: scope.orgId, snap: snapshotId, space: spaceId, limit: String(limit) },
    },
  );

  return rows.map((r) => ({
    spaceId: r.spaceId,
    label: r.label,
    weight: Number(r.weight),
    corridorId: r.corridorId,
  }));
}

/**
 * Area within Corridor within City, walked as PART_OF edges rather than a
 * materialised path (§6.2 rejects traversal_path). Three explicit hops, which
 * is the depth the vocabulary has and the depth SQL/PGQ will permit.
 */
export async function corridorAncestors(
  scope: Scope,
  snapshotId: string,
  corridorId: string,
): Promise<string[]> {
  const [row] = await chQuery<{ l1: string | null; l2: string | null; l3: string | null }>(
    `SELECT nullIf(toString(any(h1.target_id)), '') AS l1,
            nullIf(toString(any(h2.target_id)), '') AS l2,
            nullIf(toString(any(h3.target_id)), '') AS l3
       FROM (SELECT toUUID({corridor:String}) AS start) s
       LEFT JOIN ${G}.graph_edge h1
              ON h1.${TENANT} AND h1.relationship_kind = 'PART_OF' AND h1.source_id = s.start
       LEFT JOIN ${G}.graph_edge h2
              ON h2.${TENANT} AND h2.relationship_kind = 'PART_OF' AND h2.source_id = h1.target_id
       LEFT JOIN ${G}.graph_edge h3
              ON h3.${TENANT} AND h3.relationship_kind = 'PART_OF' AND h3.source_id = h2.target_id`,
    {
      orgId: scope.orgId,
      params: { org: scope.orgId, snap: snapshotId, corridor: corridorId },
    },
  );

  return [row?.l1, row?.l2, row?.l3].filter((id): id is string => Boolean(id));
}
