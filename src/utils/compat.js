/**
 * Narrow Foundry compatibility helpers for ActiveEffect change arrays.
 */

export function getEffectChanges(effect) {
  if (Array.isArray(effect?.system?.changes)) return effect.system.changes;
  if (Array.isArray(effect?.changes)) return effect.changes;
  return [];
}

export function buildEffectChangesUpdate(changes) {
  const nextChanges = Array.isArray(changes) ? changes : [];
  const generation = Number(game?.release?.generation ?? 0) || 0;
  return generation >= 14
    ? { "system.changes": nextChanges }
    : { changes: nextChanges };
}
