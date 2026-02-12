/**
 * @file Group actor preparation
 * @module core/actors/prepare/group
 */

/**
 * Prepare Group type specific data.
 * Groups are simple containers with minimal calculations needed.
 * 
 * @param {Object} actorContext - Actor context with access to private helper methods (unused for Group)
 * @param {Object} actorData - The actor's data (actorData.system contains derived values)
 */
export function prepareGroupData(actorContext, actorData) {
  const actorSystemData = actorData.system || {};

  // Ensure common Group fields exist.
  if (typeof actorSystemData.description !== "string") actorSystemData.description = "";
  if (typeof actorSystemData.notes !== "string") actorSystemData.notes = "";

  // Ensure members is always an Array.
  if (!Array.isArray(actorSystemData.members)) actorSystemData.members = [];

  // Normalize member records.
  for (const m of actorSystemData.members) {
    if (!m || typeof m !== "object") continue;
    if (!Number.isFinite(m.sortOrder)) m.sortOrder = 0;
    if (!Number.isFinite(m.qty) || m.qty < 1) m.qty = 1;
  }

  // Sort by the stored order.
  actorSystemData.members.sort((a, b) => {
    const as = Number.isFinite(a?.sortOrder) ? a.sortOrder : 0;
    const bs = Number.isFinite(b?.sortOrder) ? b.sortOrder : 0;
    return as - bs;
  });
}
