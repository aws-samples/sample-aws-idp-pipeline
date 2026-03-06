/** Well-known entity types get a stable color. */
const KNOWN_ENTITY_COLORS: Record<string, string> = {
  PERSON: '#3b82f6',
  ORG: '#8b5cf6',
  CONCEPT: '#10b981',
  PRODUCT: '#f59e0b',
  LOCATION: '#ef4444',
  EVENT: '#ec4899',
  TECH: '#06b6d4',
};

/** Extra palette for dynamically discovered entity types. */
const DYNAMIC_PALETTE = [
  '#f472b6', // pink-400
  '#a78bfa', // violet-400
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#fb923c', // orange-400
  '#2dd4bf', // teal-400
  '#818cf8', // indigo-400
  '#c084fc', // purple-400
  '#f87171', // red-400
  '#38bdf8', // sky-400
  '#a3e635', // lime-400
  '#e879f9', // fuchsia-400
];

const dynamicColorCache = new Map<string, string>();

/**
 * Get a consistent color for any entity type.
 * Known types get their predefined color; unknown types get a
 * stable color from the dynamic palette based on insertion order.
 */
export function getEntityColor(type: string): string {
  const known = KNOWN_ENTITY_COLORS[type];
  if (known) return known;

  let cached = dynamicColorCache.get(type);
  if (!cached) {
    cached = DYNAMIC_PALETTE[dynamicColorCache.size % DYNAMIC_PALETTE.length];
    dynamicColorCache.set(type, cached);
  }
  return cached;
}

/** @deprecated Use getEntityColor() instead. Kept for backwards compat. */
export const ENTITY_TYPE_COLORS: Record<string, string> = KNOWN_ENTITY_COLORS;
export const DEFAULT_ENTITY_COLOR = '#6b7280';
export const SEGMENT_COLOR = '#60a5fa';
export const ANALYSIS_COLOR = '#c084fc';
export const DOCUMENT_COLOR = '#22c55e';
export const GRAPH_BG = '#1e2235';

export const LINK_TYPE_COLORS: Record<string, string> = {
  NEXT: '#3b82f6',
  BELONGS_TO: '#22c55e',
  MENTIONED_IN: '#8b5cf6',
  RELATES_TO: '#6b7280',
  APPEARS_IN: '#f59e0b',
};
