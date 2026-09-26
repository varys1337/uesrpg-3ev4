/**
 * src/core/combat/damage-automation.js
 * UESRPG 3e v4 — Damage Calculation and Application System (Façade)
 *
 * This file now acts as a stable public API façade.
 * Implementation has been segmented into cohesive internal modules under src/core/combat/damage/.
 *
 * Exports (unchanged):
 *  - DAMAGE_TYPES
 *  - collectItemTokens, itemHasToken, isItemMagicSource
 *  - getDamageReduction, calculateDamage
 *  - applyDamage, applyForcefulImpact, applyArmorLocationDamage, ensureUnconsciousEffect, applyHealing
 *
 * Internal modules:
 *  - damage/types.js - Damage type constants
 *  - damage/tokens.js - Item token collection and normalization
 *  - damage/reduction.js - Damage reduction calculation (armor, resistance, toughness)
 *  - damage/calc.js - Damage calculation with weapon bonuses
 *  - damage/apply.js - HP application, wound tracking, healing
 */

// Re-export from internal modules (stable public API)
export { DAMAGE_TYPES } from "./damage/types.js";
export { collectItemTokens, itemHasToken } from "./damage/tokens.js";
export { isItemMagicSource, getDamageReduction } from "./damage/reduction.js";
export { calculateDamage } from "./damage/calc.js";
export { 
  applyForcefulImpact, 
  applyArmorLocationDamage,
  ensureUnconsciousEffect
} from "./damage/apply.js";

// Stable ESM aliases enter the same service as Actor and chat actions.
export async function applyDamage(actor, damage, damageType, options = {}) {
  const { ApplyDamageService } = await import('../../application/combat/apply-damage-service.js');
  return ApplyDamageService.applySimple(actor, damage, damageType, options);
}

export async function applyHealing(actor, amount, options = {}) {
  const { ApplyDamageService } = await import('../../application/combat/apply-damage-service.js');
  return ApplyDamageService.applyHealing(actor, amount, options);
}
