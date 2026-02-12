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
 *  - applyDamage, applyForcefulImpact, ensureUnconsciousEffect, applyHealing
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
  applyDamage, 
  applyForcefulImpact, 
  ensureUnconsciousEffect, 
  applyHealing 
} from "./damage/apply.js";

// Global exposure for macros and console (preserve legacy compatibility)
// This must be re-initialized here since the internal modules don't touch window
import { DAMAGE_TYPES as DT } from "./damage/types.js";
import { getDamageReduction as GDR, isItemMagicSource as IIMS } from "./damage/reduction.js";
import { calculateDamage as CD } from "./damage/calc.js";
import { applyDamage as AD, applyHealing as AH } from "./damage/apply.js";

if (typeof window !== "undefined") {
  window.Uesrpg3e = window.Uesrpg3e || {};
  window.Uesrpg3e.damage = {
    DAMAGE_TYPES: DT,
    getDamageReduction: GDR,
    calculateDamage: CD,
    applyDamage: AD,
    applyHealing: AH,
  };
}
