/**
 * @module traits/combat-talents
 * @description Combat-talent automation layer.
 *
 * This module provides small, explicit interceptors that existing combat
 * workflows can call at well-defined points.
 *
 * Scope (initial): Combat-category talents only.
 *
 * Non-goals:
 *  - Do not refactor unrelated systems.
 *  - Do not introduce new schema fields.
 */

import {
  hasTalent,
  getTalentItem,
  getSkillRank
} from "./talents-api.js";
import { shouldYieldToRE } from "./features/rule-elements.js";
import { hasCondition } from "../conditions/condition-engine.js";
import { itemHasToken } from "../combat/damage-automation.js";
import { getEffectiveWeaponHands } from "../combat/combat-utils.js";
import { getActorCanvasToken } from "./combat-proximity.js";
import { _num as _asNumber, _lower, _buildSituationalMod } from "./_primitives.js";

export {
  promptDoSReplacement,
  applyCombatTalentDoSAdjustments,
  applyCombatTalentDoSAdjustmentsUnopposed
} from "./combat-talents-dos.js";

function maybeAddBreakdownTN(tn, mod) {
  if (!tn || typeof tn !== "object" || !mod) return;
  tn.breakdown = Array.isArray(tn.breakdown) ? tn.breakdown : [];
  tn.breakdown.push(mod);
  tn.totalMod = _asNumber(tn.totalMod, 0) + _asNumber(mod.value, 0);
  tn.finalTN = _asNumber(tn.baseTN, 0) + _asNumber(tn.totalMod, 0);
}

export function applyAttackerTalentPreTN({ attacker, declaration, situationalMods } = {}) {
  if (!attacker || !declaration || !Array.isArray(situationalMods)) return;

  const variant = _lower(declaration?.variant ?? "");
  if (variant === "precision" && hasTalent(attacker, "precise")) {
    if (shouldYieldToRE(attacker, "precise", "tnModifier", "combat", getTalentItem)) return;
    if (!situationalMods.some((m) => String(m?.key ?? "") === "talent:precise")) {
      situationalMods.push(_buildSituationalMod("talent:precise", "Precise", +20));
    }
  }
}

export function getDefenseTalentOverrides({ defender, attackMode, attackerWeaponTraits } = {}) {
  const mode = _lower(attackMode);
  const weaponCtx = attackerWeaponTraits && typeof attackerWeaponTraits === "object";
  const isRanged = (mode === "ranged");

  if (defender && isRanged && weaponCtx && hasTalent(defender, "lightningreflexes")) {
    if (shouldYieldToRE(defender, "lightningreflexes", "defenseOverride", "combat", getTalentItem)) {
      return { allowParryRanged: false, parryRangedTNMod: 0 };
    }
    return { allowParryRanged: true, parryRangedTNMod: -20 };
  }
  return { allowParryRanged: false, parryRangedTNMod: 0 };
}

export function getEvadeOverrideContext({ defender, attackMode } = {}) {
  const mode = _lower(attackMode);
  if (!defender || mode !== "melee") return null;
  if (!hasTalent(defender, "fearsome")) return null;

  const payload = {
    defenseType: "evade",
    skillName: "Persuade",
    fallbackCharacteristic: "str",
    label: "Fearsome"
  };

  return {
    fearsome: {
      available: true,
      payload
    }
  };
}

export function applyDefenderTalentTNMods({ defender, defenseType, attackMode, tn, attackerWeaponTraits } = {}) {
  if (!defender || !tn) return;
  const dt = _lower(defenseType);
  const mode = _lower(attackMode);
  if (dt === "parry" && mode === "ranged") {
    const ovr = getDefenseTalentOverrides({ defender, attackMode: mode, attackerWeaponTraits });
    if (ovr.allowParryRanged && ovr.parryRangedTNMod) {
      maybeAddBreakdownTN(tn, _buildSituationalMod("talent:lightningreflexes", "Lightning Reflexes (Ranged Parry)", ovr.parryRangedTNMod));
    }
  }
}

export function getEnemyWoundThresholdDelta({ attacker, attackMode } = {}) {
  const mode = _lower(attackMode);
  if (!attacker) return 0;
  if (mode === "melee" && hasTalent(attacker, "cripplingstrikes")) {
    if (shouldYieldToRE(attacker, "cripplingstrikes", "wtDelta", "combat", getTalentItem)) return 0;
    return -1;
  }
  if (mode === "ranged" && hasTalent(attacker, "eyeofvengeance")) {
    if (shouldYieldToRE(attacker, "eyeofvengeance", "wtDelta", "combat", getTalentItem)) return 0;
    return -1;
  }
  return 0;
}

function weaponHasQualityKey(weapon, key) {
  return itemHasToken(weapon, key);
}

function isHidden(attackerToken) {
  const docHidden = Boolean(attackerToken?.document?.hidden);
  if (docHidden) return true;
  const actor = attackerToken?.actor ?? null;
  if (!actor) return false;
  return hasCondition(actor, "hidden");
}

export function applyTalentDamageModifiers({ attacker, target, attackerToken, weapon, damageContext } = {}) {
  if (!attacker || !damageContext) return;
  if (!hasTalent(attacker, "sneakattack") && !hasTalent(attacker, "assassinate")) return;
  if (!weapon || weapon.type !== "weapon") return;

  const sneakYieldToRE = shouldYieldToRE(attacker, "sneakattack", "damageBonus", "combat", getTalentItem);

  const tok = attackerToken ?? getActorCanvasToken(attacker);
  const forcedHidden = (typeof damageContext.attackFromHidden === "boolean") ? damageContext.attackFromHidden : null;
  const hiddenNow = forcedHidden === null
    ? (tok ? isHidden(tok) : hasCondition(attacker, "hidden"))
    : forcedHidden;
  if (!hiddenNow) return;

  if (hasTalent(attacker, "sneakattack")) {
    if (sneakYieldToRE) {
      damageContext._isSneakAttack = true;
    } else {
      const stealthRank = getSkillRank(attacker, "Stealth");
      if (stealthRank > 0) {
        damageContext.talentDamageBonus = _asNumber(damageContext.talentDamageBonus, 0) + stealthRank;
        damageContext.talentNotes = Array.isArray(damageContext.talentNotes) ? damageContext.talentNotes : [];
        damageContext.talentNotes.push(`Sneak Attack: +${stealthRank} damage (Stealth rank)`);
        damageContext._isSneakAttack = true;
      }
    }
  }

  if (damageContext._isSneakAttack && hasTalent(attacker, "assassinate") && weapon) {
    const handed = getEffectiveWeaponHands(weapon);
    const isOneHanded = Boolean(handed?.isOneHanded);
    if (isOneHanded && weaponHasQualityKey(weapon, "exploitWeakness")) {
      damageContext.sneakIgnoreArmorOnly = true;
      damageContext.talentNotes = Array.isArray(damageContext.talentNotes) ? damageContext.talentNotes : [];
      damageContext.talentNotes.push("Assassinate: Sneak Attack ignores AR (Exploit Weakness)");
    }
  }
}
