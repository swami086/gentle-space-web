// ads-agent/mcp/context-server/read-spaces.ts
import { z } from "zod";
import { withAgentTenantTx } from "./db";
import type { TaskTokenClaims } from "./task-token";

export type Space = {
  id: string;
  name: string;
  corridorId: string | null;
  desks: number | null;
  pricePerDesk: number | null;
  amenities: string[];
  updatedAt: string;
};

const MAX_LIMIT = 50;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const searchSpacesInput = z.strictObject({
  query: z.string().min(1).max(500),
  filters: z
    .strictObject({
      corridor: z.string().min(1).max(120).optional(),
      minDesks: z.number().int().min(0).optional(),
      maxDesks: z.number().int().min(1).optional(),
      maxPricePerDesk: z.number().min(0).optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(10),
});

type SpaceRow = {
  id: string;
  name: string;
  corridor_id: string | null;
  desks: number | null;
  price_per_desk: string | null;
  amenities: unknown;
  updated_at: Date;
};

function toSpace(row: SpaceRow): Space {
  return {
    id: row.id,
    name: row.name,
    corridorId: row.corridor_id,
    desks: row.desks === null ? null : Number(row.desks),
    pricePerDesk: row.price_per_desk === null ? null : Number(row.price_per_desk),
    amenities: Array.isArray(row.amenities) ? (row.amenities as string[]) : [],
    updatedAt: row.updated_at.toISOString(),
  };
}

const SPACE_COLUMNS = `id, name, corridor_id, desks, price_per_desk, amenities, updated_at`;

/**
 * ponytail: ranks by trigram-free ILIKE relevance over name and amenities, not
 * by pgvector similarity plus the AGE graph boost the agent spec's table names.
 * Ceiling: a space ranked below the limit is unreachable, exactly as noted for
 * the site's own search. Upgrade path: swap the ORDER BY for the embedding
 * distance once `listings` exposes its embedding column through
 * context.v_agent_spaces — a view change plus this one clause, no tool change.
 */
export async function searchSpaces(
  claims: TaskTokenClaims,
  input: z.input<typeof searchSpacesInput>,
): Promise<Space[]> {
  const parsed = searchSpacesInput.safeParse(input);
  if (!parsed.success || parsed.data.query.trim().length === 0) throw new Error("invalid_query");
  const { query, filters, limit } = parsed.data;
  return withAgentTenantTx(claims.orgId, async (tx) => {
    const { rows } = await tx.query<SpaceRow>(
      `SELECT ${SPACE_COLUMNS}
         FROM context.v_agent_spaces
        WHERE ($2::text IS NULL OR corridor_id::text = $2 OR name ILIKE '%' || $2 || '%')
          AND ($3::int IS NULL OR desks >= $3)
          AND ($4::int IS NULL OR desks <= $4)
          AND ($5::numeric IS NULL OR price_per_desk <= $5)
        ORDER BY (name ILIKE '%' || $1 || '%') DESC, updated_at DESC
        LIMIT $6`,
      [
        query,
        filters?.corridor ?? null,
        filters?.minDesks ?? null,
        filters?.maxDesks ?? null,
        filters?.maxPricePerDesk ?? null,
        limit,
      ],
    );
    return rows.map(toSpace);
  });
}

export async function getSpace(claims: TaskTokenClaims, spaceId: string): Promise<Space | null> {
  if (!uuid.safeParse(spaceId).success) throw new Error("invalid_space_id");
  return withAgentTenantTx(claims.orgId, async (tx) => {
    const { rows } = await tx.query<SpaceRow>(
      `SELECT ${SPACE_COLUMNS} FROM context.v_agent_spaces WHERE id = $1`,
      [spaceId],
    );
    return rows[0] ? toSpace(rows[0]) : null;
  });
}
