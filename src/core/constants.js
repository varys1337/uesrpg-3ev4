/**
 * UESRPG 3ev4 system constants (items-focused).
 * Keep this file free of Foundry runtime dependencies so it can be imported safely anywhere.
 *
 * NOTE: English display labels for the option catalogs below live in
 * src/core/config/label-catalog.js. This file stores only stable internal keys.
 * Presentation-layer code (prepare.js, display utils) resolves labels at render time.
 */

export { SYSTEM_ID, FLAG_SCOPE } from "./system/namespace.js";
import { SYSTEM_ID } from "./system/namespace.js";
import {
  AMMO_ARROW_TYPES,
  AMMO_MATERIAL_RULES,
  AMMO_MATERIALS,
  ARMOR_CLASSES,
  ARMOR_MATERIALS,
  ARMOR_PROFILES,
  ARMOR_QUALITY_RULES,
  ARMOR_WEIGHT_CLASSES,
  DEFAULTS,
  SHIELD_PROFILES,
  SHIELD_TYPE_RULES,
  SHIELD_TYPES,
  WEAPON_MATERIAL_RULES_MELEE,
  WEAPON_MATERIAL_RULES_RANGED,
  WEAPON_MATERIAL_RULES_SLING,
  WEAPON_MATERIALS,
  WEAPON_QUALITY_LEVELS,
  WEAPON_QUALITY_RULES,
} from "./constants/equipment.js";
import {
  QUALITIES_ALIASES,
  QUALITIES_CATALOG,
  QUALITIES_CORE_BY_TYPE,
  TRAITS_BY_TYPE,
} from "./constants/qualities.js";
import { SPELL_RANKS, SPELL_SCHOOLS } from "./constants/magic.js";

/**
 * Root path for this system's static assets and templates.
 * Some modules import this by name (e.g. startup.js), so it must remain a named export.
 */
export const systemRootPath = `systems/${SYSTEM_ID}`;

// Central roll formula used by all tests (PC and NPC).
export const SYSTEM_ROLL_FORMULA = "1d100";

/** Central constants object (extend as needed). */
export const UESRPG = {
  WEAPON_QUALITY_LEVELS,
  WEAPON_MATERIALS,
  ARMOR_WEIGHT_CLASSES,
  AMMO_ARROW_TYPES,
  AMMO_MATERIALS,
  WEAPON_QUALITY_RULES,
  WEAPON_MATERIAL_RULES_MELEE,
  WEAPON_MATERIAL_RULES_RANGED,
  WEAPON_MATERIAL_RULES_SLING,
  AMMO_MATERIAL_RULES,
  ARMOR_QUALITY_RULES,
  ARMOR_CLASSES,
  SHIELD_TYPES,
  ARMOR_MATERIALS,
  ARMOR_PROFILES,
  SHIELD_PROFILES,
  SHIELD_TYPE_RULES,
  QUALITIES_CATALOG,
  QUALITIES_CORE_BY_TYPE,
  TRAITS_BY_TYPE,
  QUALITIES_ALIASES,
  DEFAULTS,
  SPELL_RANKS,
  SPELL_SCHOOLS,
};

export default UESRPG;
