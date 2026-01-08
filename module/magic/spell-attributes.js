/**
 * module/magic/spell-attributes.js
 *
 * Spell attribute automation helpers for UESRPG 3ev4.
 * Implements automation for spell attributes like Instant, Mindlock, Direct, etc.
 */

/**
 * Check if spell can be cast as instant (Secondary Action/Reaction)
 * @param {Item} spell - The spell item
 * @returns {boolean} True if spell has Instant attribute
 */
export function canCastAsInstant(spell) {
  return Boolean(spell.system?.isInstant || spell.system?.attributes?.instant);
}

/**
 * Check if spell has Upkeep attribute
 * @param {Item} spell - The spell item
 * @returns {boolean} True if spell has Upkeep attribute
 */
export function hasUpkeep(spell) {
  return Boolean(spell.system?.hasUpkeep || spell.system?.attributes?.upkeep);
}

/**
 * Check if spell has Overload attribute
 * @param {Item} spell - The spell item
 * @returns {boolean} True if spell has Overload attribute
 */
export function hasOverload(spell) {
  return Boolean(spell.system?.hasOverload || spell.system?.attributes?.overload);
}

/**
 * Check if spell has Reinforce attribute
 * @param {Item} spell - The spell item
 * @returns {boolean} True if spell has Reinforce attribute
 */
export function hasReinforce(spell) {
  return Boolean(spell.system?.hasReinforce || spell.system?.attributes?.reinforce);
}

/**
 * Check if spell has Direct attribute (cannot be defended)
 * @param {Item} spell - The spell item
 * @returns {boolean} True if spell has Direct attribute
 */
export function isDirectSpell(spell) {
  return Boolean(spell.system?.isDirect || spell.system?.attributes?.direct);
}

/**
 * Get spell range type and value
 * @param {Item} spell - The spell item
 * @returns {Object} Object with type and value properties
 */
export function getSpellRange(spell) {
  return {
    type: spell.system?.rangeType || spell.system?.attributes?.rangeType || "none",
    value: spell.system?.range || spell.system?.attributes?.rangeValue || ""
  };
}

/**
 * Get Mindlock value for a spell
 * @param {Item} spell - The spell item
 * @returns {number} Mindlock value (AP reduction)
 */
export function getMindlockValue(spell) {
  return Number(spell.system?.mindlockValue || spell.system?.attributes?.mindlockValue || 0);
}

/**
 * Apply Mindlock to caster
 * @param {Actor} actor - The caster actor
 * @param {Item} spell - The spell item
 * @returns {Promise<ActiveEffect|null>} The created effect or null
 */
export async function applyMindlock(actor, spell) {
  const mindlock = getMindlockValue(spell);
  if (mindlock <= 0) return null;
  
  const effectData = {
    name: `Mindlock: ${spell.name}`,
    img: spell.img,
    origin: spell.uuid,
    disabled: false,
    changes: [
      {
        key: "system.resources.ap.max",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: -mindlock
      }
    ],
    flags: {
      "uesrpg-3ev4": {
        mindlock: true,
        spellUuid: spell.uuid,
        spellName: spell.name
      }
    }
  };
  
  const effects = await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
  return effects?.[0] ?? null;
}

/**
 * Remove Mindlock effect from caster
 * @param {Actor} actor - The caster actor
 * @param {Item} spell - The spell item
 * @returns {Promise<void>}
 */
export async function removeMindlock(actor, spell) {
  const effects = actor.effects.filter(e => {
    const flags = e.flags?.["uesrpg-3ev4"];
    return flags?.mindlock && flags?.spellUuid === spell.uuid;
  });
  
  const ids = effects.map(e => e.id);
  if (ids.length > 0) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }
}

/**
 * Get overload effect description
 * @param {Item} spell - The spell item
 * @returns {string} Overload effect description
 */
export function getOverloadEffect(spell) {
  return spell.system?.overloadEffect || spell.system?.attributes?.overloadEffect || "2x MP cost, enhanced effect";
}

/**
 * Get spell duration configuration
 * @param {Item} spell - The spell item
 * @returns {Object} Duration object with value and unit
 */
export function getSpellDuration(spell) {
  return {
    value: Number(spell.system?.duration?.value ?? 0),
    unit: spell.system?.duration?.unit || "rounds"
  };
}

/**
 * Check if spell is an attack spell
 * @param {Item} spell - The spell item
 * @returns {boolean} True if spell is an attack spell
 */
export function isAttackSpell(spell) {
  return Boolean(spell.system?.isAttackSpell);
}

/**
 * Get spell damage type
 * @param {Item} spell - The spell item
 * @returns {string} Damage type (fire, frost, shock, etc.)
 */
export function getDamageType(spell) {
  return spell.system?.damageType || "magic";
}

/**
 * Get spell damage formula
 * @param {Item} spell - The spell item
 * @returns {string} Damage formula (e.g., "1d6")
 */
export function getDamageFormula(spell) {
  return spell.system?.damageFormula || spell.system?.damage || "";
}
