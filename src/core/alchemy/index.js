/**
 * Alchemy subsystem — barrel export + API registration
 *
 * Usage in system.js (init):
 *   const { registerAlchemyApi } = await import("./core/alchemy/index.js");
 *   registerAlchemyApi();
 *
 * Usage in system.js (ready):
 *   const { initializeAlchemyRuntime } = await import("./core/alchemy/runtime.js");
 *   initializeAlchemyRuntime();
 */

// ── Local imports (needed both for re-export and for registerAlchemyApi body) ──

import {
  listPotionEffects,
  listToxinEffects,
  getEffectByKey,
  computeEffectCost,
  getEffectToxinOverrides,
  computeUpkeepDuration,
  effectHasUpkeep,
  isToxinUpkeep,
  QUALITY_TIERS,
  ALCHEMY_SCHOOLS,
  POISON_DICE,
} from "./effects.js";

import {
  getAlchemySkill,
  getAlchemyTalents,
  computeEffectiveStrength,
  computeBrewModifiers,
  validateBrewRecipe,
  createPendingBrewMessage,
  handleBrewChatAction,
  resolveBrew,
} from "./workflow.js";

import {
  shouldCreationBackfire,
  rollCreationBackfire,
  rollPotionBackfire,
  rollMinorEffects,
  formatCreationBackfire,
  CREATION_BACKFIRE_TABLE,
  POTION_BACKFIRE_TABLE,
  MINOR_EFFECTS_TABLE,
} from "./backfire.js";

import {
  initializeAlchemyRuntime,
  drinkPotion,
  applyAlchemyToWeapon,
} from "./runtime.js";

// ── Re-exports (public API surface) ──────────────────────────────────────────

export {
  listPotionEffects, listToxinEffects, getEffectByKey, computeEffectCost,
  getEffectToxinOverrides, computeUpkeepDuration, effectHasUpkeep, isToxinUpkeep,
  QUALITY_TIERS, ALCHEMY_SCHOOLS, POISON_DICE,
};

export {
  getAlchemySkill, getAlchemyTalents, computeEffectiveStrength,
  computeBrewModifiers, validateBrewRecipe, createPendingBrewMessage,
  handleBrewChatAction, resolveBrew,
};

export {
  shouldCreationBackfire, rollCreationBackfire, rollPotionBackfire,
  rollMinorEffects, formatCreationBackfire,
  CREATION_BACKFIRE_TABLE, POTION_BACKFIRE_TABLE, MINOR_EFFECTS_TABLE,
};

export { initializeAlchemyRuntime, drinkPotion, applyAlchemyToWeapon };

// ── API registration ──────────────────────────────────────────────────────────

/**
 * Expose the alchemy subsystem on game.uesrpg.alchemy.
 * Call once from the init hook (settings already registered at that point).
 */
export function registerAlchemyApi() {
  if (!game.uesrpg) game.uesrpg = {};
  if (game.uesrpg.alchemy) return; // idempotent

  game.uesrpg.alchemy = {
    // Lazy workshop opener — AppV2 class not imported until first call.
    openWorkshop: async (opts = {}) => {
      const { openAlchemyWorkshop } = await import("../../macros/alchemy-workshop.js");
      return openAlchemyWorkshop(opts);
    },
    drinkPotion,
    applyToWeapon: applyAlchemyToWeapon,
    effects: { listPotionEffects, listToxinEffects, getEffectByKey, computeEffectCost },
  };
}
