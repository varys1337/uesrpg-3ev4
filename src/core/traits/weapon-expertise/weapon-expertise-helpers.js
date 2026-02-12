/**
 * @module traits/weapon-expertise/weapon-expertise-helpers
 * @description Weapon matching utilities for Weapon Expertise talent automation.
 * Pure functions — no side effects.
 */

import { normalizeWeaponName, WEAPON_EXPERTISE } from "./weapon-expertise-map.js";
import { hasTalent } from "../talents-api.js";
import { itemHasToken } from "../../combat/damage-automation.js";
import { getAttackModeFromWeapon, getEffectiveWeaponHands } from "../../combat/combat-utils.js";

// ---- Weapon name matching ----

/**
 * Map of common weapon display names to their normalized canonical names.
 * Handles alternate spellings, hyphenation, and composite names.
 */
const WEAPON_DISPLAY_ALIASES = {
  // Axes
  battleaxe: ["battle axe", "battle-axe", "battleaxe"],
  waraxe: ["war axe", "war-axe", "waraxe"],
  greataxe: ["great axe", "great-axe", "greataxe"],
  handaxe: ["hand axe", "hand-axe", "handaxe"],

  // Swords
  longsword: ["longsword", "long sword", "long-sword"],
  broadsword: ["broadsword", "broad sword", "broad-sword"],
  shortsword: ["shortsword", "short sword", "short-sword"],
  greatsword: ["greatsword", "great sword", "great-sword"],

  // Exotic blades
  katana: ["katana"],
  wakizashi: ["wakizashi"],
  daikatana: ["dai-katana", "daikatana", "dai katana"],
  tanto: ["tanto"],
  scimitar: ["scimitar"],
  sabre: ["sabre", "saber"],
  rapier: ["rapier"],

  // Blunt
  mace: ["mace"],
  maul: ["maul"],
  warhammer: ["warhammer", "war hammer", "war-hammer"],
  flail: ["flail"],
  greatflail: ["great flail", "great-flail", "greatflail"],

  // Polearms
  spear: ["spear"],
  pike: ["pike"],
  halberd: ["halberd"],
  quarterstaff: ["quarterstaff", "quarter staff", "quarter-staff"],
  trident: ["trident"],
  javelin: ["javelin"],
  lance: ["lance"],

  // Daggers
  dagger: ["dagger"],
  punchdagger: ["punch dagger", "punch-dagger", "punchdagger"],
  parryingdagger: ["parrying dagger", "parrying-dagger", "parryingdagger"],

  // Hook weapons
  hooksword: ["hook sword", "hook-sword", "hooksword"],
  billhook: ["bill hook", "billhook", "bill-hook"],

  // Ranged
  longbow: ["longbow", "long bow", "long-bow"],
  shortbow: ["shortbow", "short bow", "short-bow"],
  crossbow: ["crossbow", "cross bow", "cross-bow"],
  arbalest: ["arbalest"],
  sling: ["sling"],
  bola: ["bola"],

  // Thrown
  throwingstar: ["throwing star", "throwing-star", "throwingstar", "shuriken"],
  throwingdart: ["throwing dart", "throwing-dart", "throwingdart"],
};

/**
 * Build a reverse lookup: normalized alias → canonical key.
 */
const _ALIAS_REVERSE = (() => {
  const map = {};
  for (const [canonical, aliases] of Object.entries(WEAPON_DISPLAY_ALIASES)) {
    for (const alias of aliases) {
      map[normalizeWeaponName(alias)] = canonical;
    }
    map[canonical] = canonical;
  }
  return map;
})();

/**
 * Resolve a weapon item's name to its canonical normalized key.
 * @param {Item} weapon - A weapon Item document
 * @returns {string} canonical normalized weapon key, or normalized item name if no alias match
 */
export function resolveWeaponKey(weapon) {
  if (!weapon) return "";
  const raw = normalizeWeaponName(weapon.name);
  if (!raw) return "";

  // Direct alias match
  if (_ALIAS_REVERSE[raw]) return _ALIAS_REVERSE[raw];

  // Check if the weapon name starts with or contains a known canonical name
  for (const [canonical, aliases] of Object.entries(WEAPON_DISPLAY_ALIASES)) {
    for (const alias of aliases) {
      const norm = normalizeWeaponName(alias);
      if (raw === norm || raw.startsWith(norm) || raw.endsWith(norm)) {
        return canonical;
      }
    }
  }

  return raw;
}

/**
 * Check if a weapon matches a set of required weapon keys.
 * @param {Item} weapon - A weapon Item document
 * @param {string[]} requiredKeys - Array of normalized canonical weapon keys
 * @returns {boolean}
 */
export function weaponMatchesAny(weapon, requiredKeys) {
  if (!weapon || !Array.isArray(requiredKeys) || !requiredKeys.length) return false;
  const key = resolveWeaponKey(weapon);
  if (!key) return false;
  return requiredKeys.includes(key);
}

/**
 * Check if a weapon matches a specific Weapon Expertise talent's weapon requirements.
 * @param {Item} weapon - A weapon Item document
 * @param {string} talentSlug - The talent slug key from WEAPON_EXPERTISE
 * @returns {boolean}
 */
export function weaponMatchesTalent(weapon, talentSlug) {
  const def = WEAPON_EXPERTISE[talentSlug];
  if (!def) return false;

  // If weapons array is empty, there's a special rule (e.g., all thrown, all natural, all with quality)
  if (!def.weapons.length) return true;

  return weaponMatchesAny(weapon, def.weapons);
}

/**
 * Check if the weapon's attack mode matches the talent's required mode.
 * @param {Item} weapon - A weapon Item document
 * @param {string} talentSlug - The talent slug key
 * @returns {boolean}
 */
export function attackModeMatchesTalent(weapon, talentSlug) {
  const def = WEAPON_EXPERTISE[talentSlug];
  if (!def) return false;
  if (def.attackMode === "any") return true;

  const mode = getAttackModeFromWeapon(weapon);
  return mode === def.attackMode;
}

/**
 * Full eligibility check: actor has the talent, weapon matches, and attack mode matches.
 * @param {Actor} actor
 * @param {Item} weapon
 * @param {string} talentSlug
 * @returns {boolean}
 */
export function isWeaponExpertiseActive(actor, weapon, talentSlug) {
  if (!actor || !weapon) return false;
  if (!hasTalent(actor, talentSlug)) return false;
  if (!weaponMatchesTalent(weapon, talentSlug)) return false;
  if (!attackModeMatchesTalent(weapon, talentSlug)) return false;
  return true;
}

/**
 * Get all weapon expertise talents that are active for a given actor + weapon combination.
 * @param {Actor} actor
 * @param {Item} weapon
 * @returns {{ slug: string, def: object }[]}
 */
export function getActiveWeaponExpertise(actor, weapon) {
  if (!actor || !weapon) return [];
  const results = [];
  for (const [slug, def] of Object.entries(WEAPON_EXPERTISE)) {
    if (isWeaponExpertiseActive(actor, weapon, slug)) {
      results.push({ slug, def });
    }
  }
  return results;
}

/**
 * Check if a weapon has the "thrown" quality/trait.
 * @param {Item} weapon
 * @returns {boolean}
 */
export function isWeaponThrown(weapon) {
  return itemHasToken(weapon, "thrown");
}

/**
 * Check if a weapon has the "handToHand" quality/trait.
 * @param {Item} weapon
 * @returns {boolean}
 */
export function isWeaponHandToHand(weapon) {
  return itemHasToken(weapon, "handToHand");
}

/**
 * Check if a weapon has the "Dueling Weapon" quality.
 * @param {Item} weapon
 * @returns {boolean}
 */
export function isWeaponDueling(weapon) {
  return itemHasToken(weapon, "duelingWeapon") || itemHasToken(weapon, "dueling");
}

/**
 * Get the actor's characteristic bonus.
 * @param {Actor} actor
 * @param {string} charId - e.g., "str", "agi", "end", "wil"
 * @returns {number}
 */
export function getCharBonus(actor, charId) {
  if (!actor) return 0;
  const v = Number(actor.system?.characteristics?.[charId]?.bonus ?? 0);
  return Number.isFinite(v) ? v : 0;
}
