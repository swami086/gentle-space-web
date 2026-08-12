import { z } from "zod";
import { withAgentTenantTx } from "./db";
import type { TaskTokenClaims } from "./task-token";

/**
 * Free-form query text cannot be made safe (validation report F-19). Statement-
 * type validation is a denylist, and read-only statements still exfiltrate
 * through subqueries against system catalogs, CTEs, UNION branches that escape a
 * top-level predicate, and blind timing oracles that leak a bit at a time.
 *
 * So the model supplies a template NAME and VALUES. The SQL is a module constant
 * and is never assembled from input. New traversals are added by writing a
 * template here, not by a model composing one.
 */
export const GRAPH_TEMPLATE_NAMES = [
  "spaces_in_corridor",
  "enquiries_for_space",
  "corridors_for_contact",
] as const;

export type GraphTemplateName = (typeof GRAPH_TEMPLATE_NAMES)[number];

export type GraphQueryErrorCode = "unknown_template" | "invalid_params";

export class GraphQueryError extends Error {
  constructor(readonly code: GraphQueryErrorCode) {
    super(code);
    this.name = "GraphQueryError";
  }
}

const MAX_ROWS = 200;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const limit = z.number().int().min(1).max(MAX_ROWS).default(50);

type Template<S extends z.ZodType> = {
  description: string;
  schema: S;
  sql: string;
  bind: (params: z.output<S>) => unknown[];
};

function template<S extends z.ZodType>(t: Template<S>): Template<z.ZodType> {
  return t as unknown as Template<z.ZodType>;
}

const TEMPLATES: Record<GraphTemplateName, Template<z.ZodType>> = {
  spaces_in_corridor: template({
    description: "Spaces linked to a corridor, most recently updated first",
    schema: z.strictObject({ corridor_id: uuid, limit }),
    sql: `SELECT n.node_id, n.node_kind, n.props
            FROM context.v_agent_graph_edge e
            JOIN context.v_agent_graph_node n ON n.node_id = e.source_id
           WHERE e.relationship = 'IN_CORRIDOR'
             AND e.target_id = $1
             AND n.node_kind = 'Space'
           ORDER BY n.node_id
           LIMIT $2`,
    bind: (p) => [p.corridor_id, p.limit],
  }),
  enquiries_for_space: template({
    description: "Enquiries that referenced a given space",
    schema: z.strictObject({ space_id: uuid, limit }),
    sql: `SELECT n.node_id, n.node_kind, n.props
            FROM context.v_agent_graph_edge e
            JOIN context.v_agent_graph_node n ON n.node_id = e.source_id
           WHERE e.relationship = 'ENQUIRED_ABOUT'
             AND e.target_id = $1
             AND n.node_kind = 'Enquiry'
           ORDER BY n.node_id
           LIMIT $2`,
    bind: (p) => [p.space_id, p.limit],
  }),
  corridors_for_contact: template({
    description: "Corridors a contact has shown interest in, via their enquiries",
    schema: z.strictObject({ contact_id: uuid, limit }),
    sql: `SELECT DISTINCT c.node_id, c.node_kind, c.props
            FROM context.v_agent_graph_edge person_enq
            JOIN context.v_agent_graph_edge enq_corr
              ON enq_corr.source_id = person_enq.target_id
             AND enq_corr.relationship = 'IN_CORRIDOR'
            JOIN context.v_agent_graph_node c
              ON c.node_id = enq_corr.target_id AND c.node_kind = 'Corridor'
           WHERE person_enq.relationship = 'MADE_ENQUIRY'
             AND person_enq.source_id = $1
           ORDER BY c.node_id
           LIMIT $2`,
    bind: (p) => [p.contact_id, p.limit],
  }),
};

function isTemplateName(name: string): name is GraphTemplateName {
  return (GRAPH_TEMPLATE_NAMES as readonly string[]).includes(name);
}

export function describeGraphTemplates(): {
  name: GraphTemplateName;
  description: string;
  params: string[];
}[] {
  return GRAPH_TEMPLATE_NAMES.map((name) => {
    const schema = TEMPLATES[name].schema as unknown as z.ZodObject<z.ZodRawShape>;
    return {
      name,
      description: TEMPLATES[name].description,
      params: Object.keys(schema.shape),
    };
  });
}

export async function runGraphQuery(
  claims: TaskTokenClaims,
  input: { template: string; params: Record<string, unknown> },
): Promise<Record<string, unknown>[]> {
  if (!isTemplateName(input.template)) throw new GraphQueryError("unknown_template");
  const t = TEMPLATES[input.template];
  const parsed = t.schema.safeParse(input.params);
  if (!parsed.success) throw new GraphQueryError("invalid_params");

  return withAgentTenantTx(claims.orgId, async (tx) => {
    // Defence in depth alongside the role's session default: a traversal that
    // fans out cannot hold a connection or become a timing oracle.
    await tx.query("SET LOCAL statement_timeout = '3s'");
    const { rows } = await tx.query<Record<string, unknown>>(t.sql, t.bind(parsed.data));
    return rows.slice(0, MAX_ROWS);
  });
}
