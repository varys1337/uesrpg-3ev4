/**
 * src/config/index.js
 *
 * Public barrel re-export for the UESRPG 3ev4 configuration layer.
 *
 * This module provides a single stable import path for the most commonly needed
 * config identifiers. All actual definitions live in their canonical source files:
 *   - src/core/constants.js                  → SYSTEM_ID, FLAG_SCOPE, systemRootPath
 *   - src/core/config/special-actions.js     → SPECIAL_ACTIONS, SPECIAL_ACTIONS_BY_ID, getSpecialActionById
 *   - src/core/config/label-catalog.js       → label maps + resolver helpers
 *
 * No behavior is defined here. Zero runtime cost beyond the re-export indirection.
 */

export { SYSTEM_ID, FLAG_SCOPE, systemRootPath } from "../core/constants.js";
export { SPECIAL_ACTIONS, SPECIAL_ACTIONS_BY_ID, getSpecialActionById } from "../core/config/special-actions.js";
export {
  WEAPON_QUALITY_LABELS,
  WEAPON_MATERIAL_LABELS,
  AMMO_MATERIAL_LABELS,
  AMMO_ARROW_TYPE_LABELS,
  ARMOR_WEIGHT_CLASS_LABELS,
  ARMOR_CLASS_LABELS,
  ACTOR_SIZE_LABELS,
  ACTOR_ARMOR_CLASS_LABELS,
  SUPPLY_DICE_LABELS,
  ARMOR_MATERIAL_LABELS,
  SHIELD_TYPE_LABELS,
  SPELL_SCHOOL_LABELS,
  SPELL_RANK_LABELS,
  TRAINING_RANK_LABELS,
  CIRCUMSTANCE_MOD_LABELS,
  ITEM_QUALITY_LABELS,
  resolveLabel,
  resolveQualityCatalog
} from "../core/config/label-catalog.js";
