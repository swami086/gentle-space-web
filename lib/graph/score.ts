import { ENTITY_WEIGHTS, type QueryEntities, type VectorGraphCandidate } from "./types";

export function overlapFromMatched(matched: QueryEntities): number {
  return (
    matched.areas.length * ENTITY_WEIGHTS.Area +
    matched.amenities.length * ENTITY_WEIGHTS.Amenity +
    matched.deskTypes.length * ENTITY_WEIGHTS.DeskType +
    matched.landmarks.length * ENTITY_WEIGHTS.Landmark +
    matched.budgetSignals.length * ENTITY_WEIGHTS.BudgetSignal
  );
}

export function maxPossibleOverlap(entities: QueryEntities): number {
  return overlapFromMatched(entities);
}

export function graphBoostLambda(): number {
  const n = Number(process.env.GRAPH_BOOST_LAMBDA ?? 0.35);
  return Number.isFinite(n) ? n : 0.35;
}

/** Caller always passes maxPossible from query entities (0 → vector-only order). */
export function mergeVectorAndGraphScores(
  candidates: VectorGraphCandidate[],
  lambda: number,
  maxPossible: number,
): VectorGraphCandidate[] {
  return [...candidates].sort((a, b) => {
    const ga = maxPossible > 0 ? a.graphOverlap / maxPossible : 0;
    const gb = maxPossible > 0 ? b.graphOverlap / maxPossible : 0;
    const fa = a.vectorSimilarity + lambda * ga;
    const fb = b.vectorSimilarity + lambda * gb;
    if (fb !== fa) return fb - fa;
    return b.vectorSimilarity - a.vectorSimilarity;
  });
}
