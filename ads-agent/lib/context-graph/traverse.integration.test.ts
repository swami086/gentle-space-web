/**
 * The S8 gate. Seeds a known graph directly into ClickHouse, then asks the
 * traversal for an answer computed independently by hand.
 *
 * Fixture: corridor HSR has one campaign with 4 enquiries of which 3 closed;
 * corridor ORR has one campaign with 4 enquiries of which 1 closed. So HSR
 * converts at 0.75 and ORR at 0.25, and HSR must come first.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Scope } from "../db/scope-sql";
import { chCommand, chQuery } from "./clickhouse";
import { convertingCorridors, corridorAncestors, substituteSpaces } from "./traverse";

if (!process.env.CLICKHOUSE_URL) {
  throw new Error("traverse.integration.test.ts requires CLICKHOUSE_URL");
}

const ORG = randomUUID();
const OTHER_ORG = randomUUID();
const SNAP = randomUUID();
const scope: Scope = { kind: "org", orgId: ORG };
const other: Scope = { kind: "org", orgId: OTHER_ORG };

const HSR = randomUUID();
const ORR = randomUUID();
const CITY = randomUUID();
const CAMPAIGN_HSR = randomUUID();
const CAMPAIGN_ORR = randomUUID();
const SPACE = randomUUID();
const SUBSTITUTE = randomUUID();

const node = (id: string, kind: string, label: string) =>
  `(toUUID('${ORG}'), toUUID('${SNAP}'), toUUID('${id}'), '${kind}', '${label}', NULL, '{}')`;

const edge = (
  src: string,
  srcKind: string,
  kind: string,
  tgt: string,
  tgtKind: string,
  weight = "NULL",
) =>
  `(toUUID('${ORG}'), toUUID('${SNAP}'), toUUID('${src}'), '${srcKind}', '${kind}',` +
  ` toUUID('${tgt}'), '${tgtKind}', NULL, ${weight}, NULL, '{}')`;

beforeAll(async () => {
  const enquiriesHsr = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const enquiriesOrr = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const closedHsr = enquiriesHsr.slice(0, 3);
  const closedOrr = enquiriesOrr.slice(0, 1);

  const nodes = [
    node(HSR, "Corridor", "HSR Layout"),
    node(ORR, "Corridor", "ORR Bellandur"),
    node(CITY, "Corridor", "Bangalore"),
    node(CAMPAIGN_HSR, "Campaign", "hsr-search"),
    node(CAMPAIGN_ORR, "Campaign", "orr-search"),
    node(SPACE, "Space", "Rejected Space"),
    node(SUBSTITUTE, "Space", "Substitute Space"),
    ...[...enquiriesHsr, ...enquiriesOrr].map((id) => node(id, "Enquiry", "closed")),
    ...[...closedHsr, ...closedOrr].map((id) => node(id, "Outcome", "won")),
  ];

  const edges = [
    edge(HSR, "Corridor", "PART_OF", CITY, "Corridor"),
    edge(ORR, "Corridor", "PART_OF", CITY, "Corridor"),
    edge(CAMPAIGN_HSR, "Campaign", "TARGETS", HSR, "Corridor"),
    edge(CAMPAIGN_ORR, "Campaign", "TARGETS", ORR, "Corridor"),
    ...enquiriesHsr.map((id) => edge(CAMPAIGN_HSR, "Campaign", "GENERATED", id, "Enquiry")),
    ...enquiriesOrr.map((id) => edge(CAMPAIGN_ORR, "Campaign", "GENERATED", id, "Enquiry")),
    ...[...closedHsr, ...closedOrr].map((id) => edge(id, "Enquiry", "RESULTED_IN", id, "Outcome")),
    edge(SPACE, "Space", "SIMILAR_TO", SUBSTITUTE, "Space", "0.91"),
    edge(SUBSTITUTE, "Space", "LOCATED_IN", HSR, "Corridor"),
  ];

  await chCommand(
    `INSERT INTO gentle_space.graph_node
       (org_id, snapshot_id, node_id, node_kind, label, subject_ref, props)
     VALUES ${nodes.join(",")}`,
  );
  await chCommand(
    `INSERT INTO gentle_space.graph_edge
       (org_id, snapshot_id, source_id, source_kind, relationship_kind, target_id,
        target_kind, meters, weight, confidence, props)
     VALUES ${edges.join(",")}`,
  );
});

afterAll(async () => {
  await chCommand(
    `ALTER TABLE gentle_space.graph_node DELETE WHERE snapshot_id = toUUID('${SNAP}')`,
  );
  await chCommand(
    `ALTER TABLE gentle_space.graph_edge DELETE WHERE snapshot_id = toUUID('${SNAP}')`,
  );
});

describe("S8 gate: the first traversal query answers correctly", () => {
  it("ranks HSR above ORR with the conversion rates computed by hand", async () => {
    const rows = await convertingCorridors(scope, SNAP, { minEnquiries: 1 });

    expect(rows.map((r) => r.corridorLabel)).toEqual(["HSR Layout", "ORR Bellandur"]);
    expect(rows[0]).toMatchObject({
      corridorId: HSR,
      corridorLabel: "HSR Layout",
      enquiries: 4,
      converted: 3,
    });
    expect(rows[0].conversionRate).toBeCloseTo(0.75, 5);
    expect(rows[1]).toMatchObject({ enquiries: 4, converted: 1 });
    expect(rows[1].conversionRate).toBeCloseTo(0.25, 5);
  });

  it("honours the minimum enquiry threshold", async () => {
    await expect(convertingCorridors(scope, SNAP, { minEnquiries: 5 })).resolves.toEqual([]);
  });

  it("finds the substitute space with its weight and corridor", async () => {
    const rows = await substituteSpaces(scope, SNAP, SPACE, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0].spaceId).toBe(SUBSTITUTE);
    expect(rows[0].label).toBe("Substitute Space");
    expect(rows[0].corridorId).toBe(HSR);
    expect(rows[0].weight).toBeCloseTo(0.91, 3);
  });

  it("walks the corridor hierarchy as PART_OF edges", async () => {
    await expect(corridorAncestors(scope, SNAP, HSR)).resolves.toEqual([CITY]);
    await expect(corridorAncestors(scope, SNAP, CITY)).resolves.toEqual([]);
  });

  it("answers nothing for a tenant that owns none of these rows", async () => {
    await expect(convertingCorridors(other, SNAP, { minEnquiries: 1 })).resolves.toEqual([]);
    await expect(substituteSpaces(other, SNAP, SPACE, 5)).resolves.toEqual([]);
  });

  it("enforces the row policy even when a caller forgets the predicate", async () => {
    const rows = await chQuery<{ c: string }>(
      `SELECT toString(count()) AS c FROM gentle_space.graph_node
        WHERE snapshot_id = toUUID('${SNAP}')`,
      {
        orgId: OTHER_ORG,
        creds: {
          url: process.env.CLICKHOUSE_URL ?? "http://127.0.0.1:8123",
          user: "tenant_reader",
          password: process.env.CLICKHOUSE_TENANT_PASSWORD ?? "tenant",
          database: "gentle_space",
        },
      },
    );
    expect(Number(rows[0].c)).toBe(0);
  });
});
