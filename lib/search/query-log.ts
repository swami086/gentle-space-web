import { getPool } from "../db/client";
import type { QueryEntities } from "../graph/types";

export type SearchQueryLogInput = {
  query: string;
  interpretedQuery: string;
  entities: QueryEntities;
  resultCount: number;
};

/**
 * Records search queries so query shape (lookup vs synthesis) can be measured
 * from real traffic before committing to a retrieval architecture. Stores only
 * the query text and parse result — no IP, user agent, or identity.
 * Soft-fails: logging must never break search.
 */
export async function logSearchQuery(input: SearchQueryLogInput): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    await getPool().query(
      `INSERT INTO search_queries (query, interpreted_query, entities, result_count)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [input.query, input.interpretedQuery, JSON.stringify(input.entities), input.resultCount],
    );
  } catch (err) {
    console.error("search query log failed", err);
  }
}
