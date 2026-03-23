/**
 * Stamina integration hooks for automatic effect application and consumption.
 * Integrates with existing roll handlers to apply stamina bonuses and consume effects.
 * 
 * Integration Status:
 * - Physical Exertion: Integrated with characteristic tests and skill tests
 * - Power Attack: Integrated with damage rolls
 * - Sprint: Integrated with Dash action
 * - Power Draw: Integrated with ranged attack reload tracking in opposed-workflow.js
 * - Power Block: Integrated with block resolution in combat workflow
 * - Heroic Action: Immediate effect, fully implemented
 */

import { getActiveStaminaEffect, consumeStaminaEffect, STAMINA_EFFECT_KEYS } from "./stamina-effects.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { SYSTEM_ID } from "../constants.js";
import { getFlagValueWithFallback } from "../system/flags.js";
import { getEffectChanges } from "../../utils/compat.js";
import { normalizeCharacteristicKey } from "../../utils/maps/characteristics.js";

/**
 * Check and apply Physical Exertion bonus to characteristic test
 * Should be called before rolling STR or END characteristic tests
 * @param {Actor} actor - The actor making the test
 * @param {string} characteristicId - The characteristic being tested (str, end, etc.)
 * @returns {Promise<number>} The bonus to apply (0 or 20)
 */
export async function applyPhysicalExertionBonus(actor, characteristicId) {
  if (!actor || !characteristicId) return 0;
  
  const charId = String(characteristicId).toLowerCase();
  
  // Physical Exertion only applies to STR/END tests
  if (charId !== 'str' && charId !== 'end') return 0;
  
  const effect = getActiveStaminaEffect(actor, STAMINA_EFFECT_KEYS.PHYSICAL_EXERTION);
  if (!effect) return 0;
  
  // Consume the effect and apply bonus
  await consumeStaminaEffect(actor, STAMINA_EFFECT_KEYS.PHYSICAL_EXERTION, {
    bonus: "+20 to test"
  });
  
  return 20;
}

/**
 * Check and apply Physical Exertion bonus to skill test
 * Should be called before rolling STR/END based skill tests (excluding Combat Style)
 * @param {Actor} actor - The actor making the test
 * @param {Item} skillItem - The skill being tested
 * @returns {Promise<number>} The bonus to apply (0 or 20)
 */
export async function applyPhysicalExertionToSkill(actor, skillItem, { selectedCharacteristicKey = null } = {}) {
  if (!actor || !skillItem) return 0;

  // Don't apply to Combat Style
  if (skillItem.type === "combatStyle") return 0;

  if (!_isStrOrEndSkill(skillItem, { selectedCharacteristicKey })) return 0;

  const effect = getActiveStaminaEffect(actor, STAMINA_EFFECT_KEYS.PHYSICAL_EXERTION);
  if (!effect) return 0;

  // If the effect uses the AE lane, do not apply or consume here.
  const changes = getEffectChanges(effect);
  const hasAeLane = changes.some(c => String(c?.key ?? "") === "system.modifiers.skills.physicalExertion");
  if (hasAeLane) return 0;

  // Legacy behavior: consume and return the manual bonus.
  await consumeStaminaEffect(actor, STAMINA_EFFECT_KEYS.PHYSICAL_EXERTION, {
    bonus: "+20 to test",
    message: `Applied to ${skillItem.name} skill test`
  });

  return 20;
}

function _resolveSkillCharacteristicKey(skillItem, selectedCharacteristicKey = null) {
  const selected = normalizeCharacteristicKey(selectedCharacteristicKey);
  if (selected === "str" || selected === "end") return selected;
  const base = normalizeCharacteristicKey(skillItem?.system?.baseCha ?? "");
  if (base === "str" || base === "end") return base;
  const governingRaw = String(skillItem?.system?.governingCha ?? "").trim().toLowerCase();
  return governingRaw
    .split(/[,\n/;]+|\s+/)
    .map((token) => normalizeCharacteristicKey(token))
    .find((token) => token === "str" || token === "end")
    ?? base;
}

function _isStrOrEndSkill(skillItem, { selectedCharacteristicKey = null } = {}) {
  const characteristicKey = _resolveSkillCharacteristicKey(skillItem, selectedCharacteristicKey);
  return characteristicKey === "str" || characteristicKey === "end";
}

export function getPhysicalExertionSkillBonus(actor, skillItem, { selectedCharacteristicKey = null } = {}) {
  if (!actor || !skillItem) return 0;
  if (skillItem.type === "combatStyle") return 0;
  if (!_isStrOrEndSkill(skillItem, { selectedCharacteristicKey })) return 0;
  const effect = getActiveStaminaEffect(actor, STAMINA_EFFECT_KEYS.PHYSICAL_EXERTION);
  return effect ? 20 : 0;
}

export async function consumePhysicalExertionForSkill(actor, skillItem, { selectedCharacteristicKey = null } = {}) {
  if (!actor || !skillItem) return 0;
  if (skillItem.type === "combatStyle") return 0;
  if (!_isStrOrEndSkill(skillItem, { selectedCharacteristicKey })) return 0;
  const effect = getActiveStaminaEffect(actor, STAMINA_EFFECT_KEYS.PHYSICAL_EXERTION);
  if (!effect) return 0;
  await consumeStaminaEffect(actor, STAMINA_EFFECT_KEYS.PHYSICAL_EXERTION, {
    bonus: "+20 to test",
    message: `Applied to ${skillItem.name} skill test`
  });
  return 20;
}

/**
 * Check and apply Power Attack bonus to damage roll
 * Should be called before rolling damage
 * @param {Actor} actor - The actor making the damage roll
 * @returns {Promise<number>} The damage bonus to apply
 */
export async function applyPowerAttackBonus(actor) {
  if (!actor) return 0;
  
  const effect = getActiveStaminaEffect(actor, STAMINA_EFFECT_KEYS.POWER_ATTACK);
  if (!effect) return 0;
  
  const bonus = getFlagValueWithFallback(effect, "damageBonus") || 0;
  
  // Consume the effect
  await consumeStaminaEffect(actor, STAMINA_EFFECT_KEYS.POWER_ATTACK, {
    bonus: `+${bonus} damage`
  });
  
  return bonus;
}

/**
 * Check and apply Sprint bonus to Dash action
 * Should be called when performing a Dash action
 * @param {Actor} actor - The actor performing the dash
 * @returns {Promise<Object|null>} Effect data if consumed, null otherwise
 */
export async function applySprintBonus(actor) {
  if (!actor) return null;
  
  const effect = getActiveStaminaEffect(actor, STAMINA_EFFECT_KEYS.SPRINT);
  if (!effect) return null;
  
  // Consume the effect
  const result = await consumeStaminaEffect(actor, STAMINA_EFFECT_KEYS.SPRINT, {
    message: "Movement range doubled for this Dash action"
  });
  
  return result;
}

function _getPowerDrawStoredReduction(weapon) {
  if (!weapon) return 0;
  try {
    const v = (typeof weapon.getFlag === "function")
      ? weapon.getFlag(SYSTEM_ID, "powerDrawReloadReduction")
      : weapon?.flags?.[SYSTEM_ID]?.powerDrawReloadReduction;
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch (_e) {
    return 0;
  }
}

async function _setPowerDrawStoredReduction(weapon, value) {
  if (!weapon) return false;
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return false;
  return requestUpdateDocument(weapon, { [`flags.${SYSTEM_ID}.powerDrawReloadReduction`]: n });
}

async function _clearPowerDrawStoredReduction(weapon) {
  if (!weapon) return false;
  return requestUpdateDocument(weapon, { [`flags.${SYSTEM_ID}.powerDrawReloadReduction`]: 0 });
}

/**
 * Check and apply Power Draw bonus to ranged attack
 * Should be called when making a ranged attack
 * @param {Actor} actor - The actor making the ranged attack
 * @param {Item} weapon - The ranged weapon being used
 * @returns {Promise<number>} The reload reduction to apply
 */
export async function applyPowerDrawBonus(actor, weapon, { storeOnWeapon = false } = {}) {
  if (!actor) return 0;

  const stored = _getPowerDrawStoredReduction(weapon);
  if (stored > 0) {
    await _clearPowerDrawStoredReduction(weapon);
    return stored;
  }
  
  const effect = getActiveStaminaEffect(actor, STAMINA_EFFECT_KEYS.POWER_DRAW);
  if (!effect) return 0;
  
  // Consume the effect
  await consumeStaminaEffect(actor, STAMINA_EFFECT_KEYS.POWER_DRAW, {
    message: `Reload time reduced by 1 for ${weapon?.name || "ranged weapon"}`
  });

  if (storeOnWeapon && weapon) {
    await _setPowerDrawStoredReduction(weapon, 1);
  }
  
  return 1;
}

/**
 * Check and apply Power Block bonus to shield block
 * Should be called when resolving a block with a shield
 * @param {Actor} actor - The actor blocking
 * @param {number} originalBR - The original BR value of the shield
 * @returns {Promise<number>} The effective BR to use (doubled if effect active)
 */
export async function applyPowerBlockBonus(actor, originalBR) {
  if (!actor) return originalBR;
  
  const effect = getActiveStaminaEffect(actor, STAMINA_EFFECT_KEYS.POWER_BLOCK);
  if (!effect) return originalBR;
  
  const doubledBR = originalBR * 2;
  
  // Consume the effect
  await consumeStaminaEffect(actor, STAMINA_EFFECT_KEYS.POWER_BLOCK, {
    message: `Shield BR doubled: ${originalBR} → ${doubledBR} (physical damage only)`
  });
  
  return doubledBR;
}

/**
 * Helper to check if any stamina effect is active
 * @param {Actor} actor - The actor to check
 * @param {string} effectKey - The effect key to check
 * @returns {boolean} True if the effect is active
 */
export function hasStaminaEffect(actor, effectKey) {
  return getActiveStaminaEffect(actor, effectKey) !== null;
}
