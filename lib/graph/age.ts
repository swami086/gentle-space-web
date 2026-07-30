import { normalizeEntityName } from "./normalize";
import { overlapFromMatched } from "./score";
import type { QueryEntities } from "./types";
import { emptyQueryEntities } from "./types";
import type { PoolClient } from "pg";
import { getPool } from "../db/client";

type ListingInput = {
  id: string;
  slug: string;
  title: string;
  entities: QueryEntities;
};

type ScoredListing = {
  overlap: number;
  matched: QueryEntities;
};

const EDGE_TO_BUCKET = {
  IN_AREA: "areas",
  HAS_AMENITY: "amenities",
  HAS_DESK_TYPE: "deskTypes",
  NEAR: "landmarks",
  HAS_BUDGET: "budgetSignals",
} as const;

type Bucket = keyof QueryEntities;

const UNSAFE_CYPHER_LITERAL_RE = /(?:\$\$|[\\\u0000-\u001f\u007f])/;

export function sanitizeCypherLiteral(value: string): string {
  if (UNSAFE_CYPHER_LITERAL_RE.test(value)) {
    throw new Error("unsafe cypher literal");
  }
  return value;
}

function escapeCypherString(value: string): string {
  return sanitizeCypherLiteral(value).replace(/'/g, "''");
}

function cypherString(value: string): string {
  return `'${escapeCypherString(value)}'`;
}

function cypherStringList(values: string[]): string {
  return `[${values.map(cypherString).join(", ")}]`;
}

function isEmptyEntities(entities: QueryEntities): boolean {
  return (
    entities.areas.length === 0 &&
    entities.amenities.length === 0 &&
    entities.deskTypes.length === 0 &&
    entities.landmarks.length === 0 &&
    entities.budgetSignals.length === 0
  );
}

function normalizeQueryBucket(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeEntityName(value)).filter(Boolean))];
}

function normalizeQueryEntities(entities: QueryEntities): QueryEntities {
  return {
    areas: normalizeQueryBucket(entities.areas),
    amenities: normalizeQueryBucket(entities.amenities),
    deskTypes: normalizeQueryBucket(entities.deskTypes),
    landmarks: normalizeQueryBucket(entities.landmarks),
    budgetSignals: normalizeQueryBucket(entities.budgetSignals),
  };
}

function entityListToCypher(entityType: string, values: string[]): string {
  if (values.length === 0) return "";
  const aliasPrefix = entityType.toLowerCase();
  const merges = values.map((value, index) => {
    const alias = `${aliasPrefix}_${index}`;
    return `MERGE (${alias}:${entityType} {name: ${cypherString(value)}})
MERGE (l)-[:${entityTypeToEdge(entityType)}]->(${alias})`;
  });
  return merges.join("\n");
}

function entityTypeToEdge(entityType: string): string {
  switch (entityType) {
    case "Area":
      return "IN_AREA";
    case "Amenity":
      return "HAS_AMENITY";
    case "DeskType":
      return "HAS_DESK_TYPE";
    case "Landmark":
      return "NEAR";
    case "BudgetSignal":
      return "HAS_BUDGET";
    default:
      return "HAS_AMENITY";
  }
}

function agtypeText(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  return trimmed;
}

function bucketForEdge(edge: string): Bucket | null {
  const bucket = EDGE_TO_BUCKET[edge as keyof typeof EDGE_TO_BUCKET];
  return bucket ?? null;
}

export async function ensureAgeSession(client: PoolClient): Promise<void> {
  await client.query("LOAD 'age'");
  await client.query('SET search_path TO ag_catalog, "$user", public');
}

export async function isAgeAvailable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;

  let client: PoolClient | null = null;
  try {
    client = await getPool().connect();
    await ensureAgeSession(client);
    const result = await client.query<{ exists: boolean }>(
      "SELECT 1 AS exists FROM ag_catalog.ag_graph WHERE name = 'gentle_space' LIMIT 1",
    );
    return result.rows.length > 0;
  } catch {
    return false;
  } finally {
    client?.release();
  }
}

export async function wipeGentleSpaceGraph(): Promise<void> {
  if (!process.env.DATABASE_URL) return;

  const client = await getPool().connect();
  try {
    await ensureAgeSession(client);
    await client.query("SELECT * FROM cypher('gentle_space', $$ MATCH (n) DETACH DELETE n $$) AS (v agtype)");
  } finally {
    client.release();
  }
}

function listingUpsertCypher(input: ListingInput): string {
  const entityCypher = [
    entityListToCypher("Area", normalizeQueryBucket(input.entities.areas)),
    entityListToCypher("Amenity", normalizeQueryBucket(input.entities.amenities)),
    entityListToCypher("DeskType", normalizeQueryBucket(input.entities.deskTypes)),
    entityListToCypher("Landmark", normalizeQueryBucket(input.entities.landmarks)),
    entityListToCypher("BudgetSignal", normalizeQueryBucket(input.entities.budgetSignals)),
  ]
    .filter(Boolean)
    .join("\n");

  return `
MERGE (l:Listing {id: ${cypherString(input.id)}})
SET l.slug = ${cypherString(input.slug)},
    l.title = ${cypherString(input.title)}
${entityCypher ? `${entityCypher}\n` : ""}RETURN l.id AS listing_id
`.trim();
}

export async function upsertListingGraph(input: ListingInput): Promise<void> {
  if (!process.env.DATABASE_URL) return;

  const client = await getPool().connect();
  try {
    await ensureAgeSession(client);
    await client.query("BEGIN");
    await client.query(
      `SELECT * FROM cypher('gentle_space', $$ ${listingUpsertCypher(input)} $$) AS (listing_id agtype)`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function scoreListingsAgainstQuery(
  listingIds: string[],
  query: QueryEntities,
): Promise<Map<string, ScoredListing>> {
  if (!process.env.DATABASE_URL) return new Map();

  const normalizedQuery = normalizeQueryEntities(query);
  if (isEmptyEntities(normalizedQuery) || listingIds.length === 0) {
    return new Map();
  }

  const uniqueListingIds = [...new Set(listingIds)];
  const client = await getPool().connect();

  try {
    await ensureAgeSession(client);
    const result = await client.query<{
      listing_id: unknown;
      rel: unknown;
      elabel: unknown;
      name: unknown;
    }>(
      `SELECT * FROM cypher('gentle_space', $$ 
        MATCH (l:Listing)-[r]->(e)
        WHERE l.id IN ${cypherStringList(uniqueListingIds)}
        RETURN l.id AS listing_id, type(r) AS rel, label(e)[0] AS elabel, e.name AS name
      $$) AS (listing_id agtype, rel agtype, elabel agtype, name agtype)`,
    );

    const scored = new Map<string, ScoredListing>();
    for (const id of uniqueListingIds) {
      scored.set(id, { overlap: 0, matched: emptyQueryEntities() });
    }

    for (const row of result.rows) {
      const listingId = agtypeText(row.listing_id);
      const rel = agtypeText(row.rel);
      const name = normalizeEntityName(agtypeText(row.name));
      const bucket = bucketForEdge(rel);
      if (!listingId || !bucket || !name) continue;

      const current = scored.get(listingId) ?? { overlap: 0, matched: emptyQueryEntities() };
      const bucketValues = normalizedQuery[bucket];
      if (!bucketValues.includes(name)) continue;

      if (!current.matched[bucket].includes(name)) {
        current.matched[bucket] = [...current.matched[bucket], name];
        current.overlap = overlapFromMatched(current.matched);
        scored.set(listingId, current);
      }
    }

    for (const [id, value] of scored) {
      value.overlap = overlapFromMatched(value.matched);
      scored.set(id, value);
    }

    return scored;
  } finally {
    client.release();
  }
}
