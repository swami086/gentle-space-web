export type QueryEntities = {
  areas: string[];
  amenities: string[];
  deskTypes: string[];
  landmarks: string[];
  budgetSignals: string[];
};

export function emptyQueryEntities(): QueryEntities {
  return { areas: [], amenities: [], deskTypes: [], landmarks: [], budgetSignals: [] };
}

export const ENTITY_WEIGHTS = {
  Area: 3,
  Amenity: 1,
  DeskType: 3,
  Landmark: 2,
  BudgetSignal: 2,
} as const;

export type VectorGraphCandidate = {
  id: string;
  vectorSimilarity: number;
  graphOverlap: number;
  matchedEntities: QueryEntities;
};
