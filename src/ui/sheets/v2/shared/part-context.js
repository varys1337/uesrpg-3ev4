/**
 * Build a normalized AppV2 part-request scope for context preparation.
 * Returns a `needs(part)` predicate that is true for full renders or when a part
 * is explicitly requested in partial render cycles.
 */
export function createPartContextScope({ options, partDefinitions, fallbackTotal = 0 } = {}) {
  const requested = Array.isArray(options?.parts) ? options.parts : [];
  const requestedParts = new Set(requested);
  const totalParts = Object.keys(partDefinitions ?? {}).length || fallbackTotal;
  const partialRender = requestedParts.size > 0 && requestedParts.size < totalParts;
  const needs = (part) => !partialRender || requestedParts.has(part);

  return {
    requestedParts,
    requestedList: requested,
    totalParts,
    partialRender,
    needs,
  };
}
